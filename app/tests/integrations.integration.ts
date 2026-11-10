import { emptyProject } from "../src/projects/model.ts";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { chromium, expect } from "@playwright/test";
import type { BragAuth } from "../src/lib/auth/config.ts";
import type { RuntimeConfig } from "../src/lib/config/runtime.ts";
import type { createDatabase } from "../src/lib/database/client.ts";
import { credentialVault } from "../src/lib/config/vault.ts";
import {
  integrationOperations,
  configSecrets,
  pitchConfigFor,
} from "../src/lib/integrations/settings.ts";
import { activePitchConfig } from "../src/lib/integrations/settings.ts";
import { pitchWorker } from "../src/lib/projects/worker.ts";
import type { PitchProviders } from "../src/lib/projects/providers.ts";
import { encodeWav } from "../src/projects/audio.ts";
import { audioStore } from "../src/lib/projects/storage.ts";

export async function integrationChecks(
  t: TestContext,
  fixture: { baseUrl: string; authFile: string; container: string },
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  admin: pg.Client,
  runtime: pg.Client,
  adminCookie: string,
  ordinaryCookie: string,
  config: RuntimeConfig,
) {
  const keyFile = path.join(path.dirname(fixture.authFile), "credential-key");
  const vault = credentialVault(Buffer.from((await readFile(keyFile, "utf8")).trim(), "base64"));
  const ops = integrationOperations(auth, db, vault),
    headers = new Headers({ Cookie: adminCookie });
  const token = "distill-fixture-" + randomUUID(),
    key = "anthropic-fixture-" + randomUUID();
  const base = {
    expected_version: 0,
    enabled: true,
    distill_origin: "https://distill.example.test",
    claude_model: "claude-fixture-20260101",
    distill_token: token,
    anthropic_key: key,
  };
  const request = (cookie: string, body?: unknown, id = randomUUID(), origin = config.origin) =>
    fetch(fixture.baseUrl + "/api/v1/admin/integrations", {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await t.test(
    "integration settings require current admin in HTTP and direct operations; origin and size are enforced",
    async () => {
      assert.equal((await request("")).status, 401);
      assert.equal((await request(ordinaryCookie, base)).status, 403);
      await assert.rejects(
        ops.read(new Headers({ Cookie: ordinaryCookie })),
        (e: unknown) => (e as { status: number }).status === 403,
      );
      await assert.rejects(
        ops.save(new Headers({ Cookie: ordinaryCookie }), randomUUID(), base),
        (e: unknown) => (e as { status: number }).status === 403,
      );
      assert.equal(
        (await request(adminCookie, base, randomUUID(), "https://foreign.example")).status,
        403,
      );
      assert.equal(
        (await request(adminCookie, { ...base, distill_token: "a".repeat(25000) })).status,
        400,
      );
      const initial = await request(adminCookie);
      assert.match(initial.headers.get("cache-control") || "", /no-store/);
      assert.equal((await initial.json()).settings.storage_ready, true);
    },
  );
  await t.test(
    "saved keys are encrypted, never returned, versioned and cannot be rewritten with runtime SQL",
    async () => {
      const id = randomUUID();
      const saved = await request(adminCookie, base, id);
      assert.equal(saved.status, 200);
      const text = await saved.text();
      assert.ok(!text.includes(token) && !text.includes(key) && !text.includes("sealed"));
      assert.equal(JSON.parse(text).settings.distill_token_saved, true);
      const row = await db.processorConfig.findUniqueOrThrow({ where: { version: 1 } });
      assert.ok(!JSON.stringify(row).includes(token) && !JSON.stringify(row).includes(key));
      assert.deepEqual(configSecrets(row, vault), { distill_token: token, anthropic_key: key });
      assert.equal((await request(adminCookie, base, id)).status, 200);
      assert.equal(await db.processorConfig.count(), 1);
      assert.equal((await request(adminCookie, { ...base, enabled: false }, id)).status, 409);
      for (const sql of [
        "UPDATE brag.processor_config SET enabled=false",
        "DELETE FROM brag.processor_config",
        "UPDATE brag.voice_pitch SET config_version=NULL",
      ])
        await assert.rejects(
          runtime.query(sql),
          (e: unknown) => (e as { code: string }).code === "42501",
        );
    },
  );
  await t.test(
    "key rotation preserves previous revisions, blank keeps values, removal disables new pitches and stale saves conflict",
    async () => {
      const update = {
        expected_version: 1,
        enabled: true,
        distill_origin: base.distill_origin,
        claude_model: base.claude_model,
      };
      const competing = await Promise.all([
        request(adminCookie, update),
        request(adminCookie, update),
      ]);
      assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
      const second = await db.processorConfig.findUniqueOrThrow({ where: { version: 2 } });
      assert.equal(configSecrets(second, vault).distill_token, token);
      assert.equal(
        (
          await request(adminCookie, {
            ...update,
            expected_version: 2,
            distill_origin: "https://another.example.test",
          })
        ).status,
        422,
      );
      assert.equal(
        (await request(adminCookie, { ...update, expected_version: 2, distill_token: null }))
          .status,
        422,
      );
      assert.equal(
        (
          await request(adminCookie, {
            ...update,
            expected_version: 2,
            enabled: false,
            distill_token: null,
          })
        ).status,
        200,
      );
      assert.equal((await ops.read(headers)).settings.distill_token_saved, false);
      assert.equal(
        configSecrets(await db.processorConfig.findUniqueOrThrow({ where: { version: 1 } }), vault)
          .distill_token,
        token,
      );
      const wrong = integrationOperations(auth, db, credentialVault(randomBytes(32)));
      assert.equal((await wrong.read(headers)).settings.storage_ready, false);
      await assert.rejects(wrong.save(headers, randomUUID(), { ...update, expected_version: 3 }));
      assert.equal(await db.processorConfig.count(), 3);
    },
  );
  await t.test(
    "mobile and desktop Admin settings save only password inputs and clear credentials after submission and reload",
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.addCookies(
          adminCookie.split("; ").map((p) => ({
            name: p.slice(0, p.indexOf("=")),
            value: p.slice(p.indexOf("=") + 1),
            url: fixture.baseUrl,
          })),
        );
        const page = await context.newPage();
        await page.goto(fixture.baseUrl + "/admin");
        await page.getByRole("link", { name: "API setup", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Pitch integrations" })).toBeVisible();
        const field = page.getByLabel("Distill service token", { exact: false });
        await expect(field).toHaveAttribute("type", "password");
        await field.fill("new-fixture-distill-token-123456");
        await page.getByLabel("Enable voice processing for new pitches").check();
        await page.getByRole("button", { name: "Save settings", exact: true }).click();
        await expect(page.getByRole("status")).toContainText("Settings saved");
        await expect(field).toHaveValue("");
        await expect(page.getByLabel("Anthropic API key", { exact: false })).toHaveValue("");
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({
          path: `.localfiles/runtime-evidence/${fixture.container}-integrations-390.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.reload();
        await expect(field).toHaveValue("");
        await expect(
          page.getByText("Distill service token · Saved", { exact: true }),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
          ),
          0,
        );
      } finally {
        await browser.close();
      }
    },
  );
  await t.test(
    "queued pitches and cleanup use their original configuration after rotation; new reads see saves immediately",
    async () => {
      const dir = path.join(path.dirname(fixture.authFile), "integration-pitches");
      // This disposable database contains synthetic jobs from earlier checks; isolate the worker exercise.
      await admin.query(
        "UPDATE brag.voice_pitch SET status='cancelled',cleanup_pending=false,lease_until=NULL",
      );
      const draft = await db.projectDraft.findFirstOrThrow();
      const id = randomUUID();
      const recording = Buffer.from(encodeWav([new Float32Array(16000)], 16000));
      await audioStore(dir).put(id, recording);
      await db.voicePitch.create({
        data: {
          id,
          draftId: draft.id,
          ownerId: draft.ownerId,
          key: randomUUID(),
          mediaHash: createHash("sha256").update(recording).digest("hex"),
          baseVersion: draft.version,
          policy: "pitch-30s-pause-auto-distill-claude-v3",
          admittedAt: new Date(),
          sampleCount: 16000,
          configVersion: 1,
          status: "queued",
        },
      });
      const resolved: number[] = [];
      const providers: PitchProviders = {
        model: base.claude_model,
        submit: async () => ({ state: "accepted", id: randomUUID() }),
        poll: async () => ({ status: "completed" }),
        artifact: async () => [{ ln: 1, sentence: "A pitch." }],
        remove: async () => {},
        structure: async () => ({
          language: "en",
          title: "A pitch",
          problem: "",
          description: "A pitch.",
          details: structuredClone(emptyProject.details),
        }),
      };
      const tick = pitchWorker(db, { audioDirectory: dir }, undefined, async (revision) => {
        assert.equal(revision, 1);
        resolved.push(revision!);
        const original = pitchConfigFor(
          await db.processorConfig.findUniqueOrThrow({ where: { version: revision! } }),
          vault,
          dir,
        );
        assert.equal(original.distillToken, token);
        return providers;
      });
      await tick();
      await db.voicePitch.update({ where: { id }, data: { nextAttempt: new Date(0) } });
      await tick();
      await tick();
      assert.equal((await db.voicePitch.findUniqueOrThrow({ where: { id } })).status, "ready");
      assert.equal(resolved.length, 4);
      const oldDir = process.env.BRAG_PITCH_AUDIO_DIR;
      process.env.BRAG_PITCH_AUDIO_DIR = dir;
      try {
        assert.equal((await activePitchConfig(db))?.revision, 4);
      } finally {
        if (oldDir === undefined) delete process.env.BRAG_PITCH_AUDIO_DIR;
        else process.env.BRAG_PITCH_AUDIO_DIR = oldDir;
      }
    },
  );
}
