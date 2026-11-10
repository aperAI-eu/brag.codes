import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { credentialVault } from "../src/lib/config/vault.ts";
import { configContext } from "../src/lib/integrations/settings.ts";
import {
  ownedFixture,
  bootstrapSchema8,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import {
  identity,
  event,
  association,
  draft,
  pitch as seedPitch,
} from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { projectOperations } from "../src/lib/projects/operations.ts";
import { projectHandler } from "../src/lib/projects/handler.ts";
import { pitchWorker } from "../src/lib/projects/worker.ts";
import { audioStore } from "../src/lib/projects/storage.ts";
import type { PitchConfig, PitchProviders } from "../src/lib/projects/providers.ts";
import { encodeWav } from "../src/projects/audio.ts";
import { PITCH_POLICY, emptyDetails } from "../src/projects/model.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";

const backupSql = (expression: string) =>
  execFileSync(
    "python3",
    [
      "-c",
      "import runpy; b=runpy.run_path('deploy/runtime/backup-guest.py'); print(" + expression + ")",
    ],
    { encoding: "utf8" },
  );
const error = (code: string) => (value: { code?: string }) => value.code === code;
test("retained recordings recover safely across configuration revisions and schema upgrade", async (t) => {
  const f = await ownedFixture();
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const db = createDatabase(f.runtimeUrl);
  const directory = process.env.BRAG_PITCH_AUDIO_DIR!;
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  });
  await bootstrapSchema8(f);
  const runtime = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
  };
  const owner = await identity(admin, runtime.authSecret),
    other = await identity(admin, runtime.authSecret),
    e = await event(admin);
  await association(admin, owner.owner, e.id);
  owner.headers.set("x-capture-contract", "share-work-v1");
  owner.headers.set("origin", runtime.origin);
  const legacyDraft = await draft(admin, owner.owner, e.id);
  const legacyPitch = await seedPitch(admin, owner.owner, legacyDraft, "failed");
  const old = (
    await admin.query(
      "SELECT config_version,media_hash,owner_id FROM brag.voice_pitch WHERE id=$1",
      [legacyPitch],
    )
  ).rows[0];
  const beforeHashes = (await admin.query(backupSql("b['record_hashes_sql'](8)"))).rows[0]
    .json_build_object.recordHashes;
  const migration = migrateCandidate(f);
  assert.equal(migration.status, 0, migration.output);
  assert.equal(await isDatabaseReady(db), true);
  const afterHashes = (await admin.query(backupSql("b['record_hashes_sql'](9)"))).rows[0]
    .json_build_object.recordHashes;
  for (const [key, value] of Object.entries(beforeHashes)) assert.equal(afterHashes[key], value);
  assert.ok(afterHashes.pitchRecoveryFacts);
  const recoveryChecks = (await admin.query(backupSql("b['PITCH_RECOVERY_CHECK_SQL']"))).rows[0]
    .json_build_object;
  assert.deepEqual(recoveryChecks, { pitchRecoveryIntegrity: true, pitchRecoveryPrivileges: true });
  assert.deepEqual(
    (
      await admin.query(
        "SELECT config_version,media_hash,owner_id FROM brag.voice_pitch WHERE id=$1",
        [legacyPitch],
      )
    ).rows[0],
    old,
  );
  const config: PitchConfig = {
    revision: 1,
    audioDirectory: directory,
    distillOrigin: "https://example.test",
    distillToken: "fixture",
    anthropicKey: "fixture",
    model: "fixture",
  };
  const vault = credentialVault(
    Buffer.from(
      (await readFile(path.join(path.dirname(f.authFile), "credential-key"), "utf8")).trim(),
      "base64",
    ),
  );
  const addConfig = (version: number) =>
    admin.query(
      "INSERT INTO brag.processor_config(version,actor_id,request_id,intent_hmac,enabled,distill_origin,claude_model,has_distill,has_claude,sealed,changed_fields) VALUES ($1,$2,$3,$4,true,'https://example.test','fixture',true,true,$5,'{}')",
      [
        version,
        owner.owner,
        randomUUID(),
        "a".repeat(64),
        vault.seal(
          { distill_token: "fictional-distill", anthropic_key: "fictional-claude" },
          configContext({
            version,
            actorId: owner.owner,
            distillOrigin: "https://example.test",
            claudeModel: "fixture",
            enabled: true,
          }),
        ),
      ],
    );
  await addConfig(1);
  const auth = createAuth(db, runtime),
    ops = () => projectOperations(auth, db, { ...config }, runtime.origin);
  const bytes = Buffer.from(encodeWav([new Float32Array(16000)], 16000));
  const store = audioStore(directory);
  let submissions = 0;
  const providers: PitchProviders = {
    model: "fixture",
    submit: async () => {
      submissions++;
      return { state: "rejected", configuration: true };
    },
    poll: async () => ({ status: "completed" }),
    artifact: async () => [{ ln: 1, sentence: "A useful project." }],
    remove: async () => {},
    structure: async () => ({
      title: "Recovered",
      problem: "A problem",
      description: "A useful project",
      language: "en",
      details: emptyDetails,
    }),
  };
  const versions: (number | null)[] = [];
  const tick = pitchWorker(db, config, undefined, async (version) => {
    versions.push(version);
    return providers;
  });
  const upload = async () => {
    const d = (await ops().create(owner.headers, randomUUID(), { event_id: e.id })).draft;
    return {
      draft: d,
      pitch: (await ops().upload(owner.headers, d.id, randomUUID(), d.version, PITCH_POLICY, bytes))
        .pitch,
    };
  };
  const first = await upload();
  const body = { expected_version: first.draft.version, transcription_attempt: 1 };
  await tick();
  assert.equal(await store.exists(first.pitch.id), true);
  await admin.query("UPDATE brag.voice_pitch SET created_at=now()-interval '1 hour' WHERE id=$1", [
    first.pitch.id,
  ]);
  const failed = (await ops().pitch(owner.headers, first.pitch.id)).pitch;
  assert.equal(failed.recovery?.configuration_required, true);
  assert.equal(failed.recovery?.can_retry, false);
  await assert.rejects(
    ops().retryRecording(owner.headers, first.pitch.id, randomUUID(), body),
    error("voice_unavailable"),
  );
  await addConfig(2);
  config.revision = 2;
  await t.test(
    "explicit concurrent retry is idempotent and keeps original provenance",
    async () => {
      const key = randomUUID();
      const result = await Promise.all([
        ops().retryRecording(owner.headers, first.pitch.id, key, body),
        ops().retryRecording(owner.headers, first.pitch.id, key, body),
      ]);
      assert.equal(result[0].pitch.recovery?.transcription_attempt, 2);
      assert.equal(result[1].pitch.recovery?.transcription_attempt, 2);
      assert.equal(submissions, 1);
      const row = await db.voicePitch.findUniqueOrThrow({ where: { id: first.pitch.id } });
      assert.equal(row.configVersion, 1);
      assert.equal(row.recoveryConfigVersion, 2);
      assert.equal(result[0].pitch.recovery?.expires_at, failed.recovery?.expires_at);
      await assert.rejects(
        ops().retryRecording(owner.headers, first.pitch.id, randomUUID(), body),
        error("version_conflict"),
      );
      const receipt = await db.draftMutation.findUniqueOrThrow({
        where: { actorId_key: { actorId: owner.owner, key } },
      });
      assert.equal((receipt.result as { config_version: number }).config_version, 2);
      await assert.rejects(
        db.voicePitch.update({ where: { id: first.pitch.id }, data: { configVersion: 2 } }),
      );
    },
  );
  await t.test(
    "corrected settings process the retained bytes and delete only after transcription",
    async () => {
      providers.submit = async (audio) => {
        submissions++;
        assert.deepEqual(audio, bytes);
        return { state: "accepted", id: randomUUID() };
      };
      await tick();
      assert.equal(versions.at(-1), 2);
      assert.equal(await store.exists(first.pitch.id), true);
      await admin.query("UPDATE brag.voice_pitch SET next_attempt=now() WHERE id=$1", [
        first.pitch.id,
      ]);
      await tick();
      assert.equal(await store.exists(first.pitch.id), false);
      await tick();
      assert.equal((await ops().pitch(owner.headers, first.pitch.id)).pitch.status, "ready");
      assert.equal((await ops().read(owner.headers, first.draft.id)).draft.fields.title, "");
    },
  );
  await t.test(
    "uncertain dispatch never repeats; missing, cancelled and expired media never promise recovery",
    async () => {
      providers.submit = async () => {
        submissions++;
        return { state: "uncertain" };
      };
      const item = await upload();
      await tick();
      assert.equal(await store.exists(item.pitch.id), true);
      assert.equal(
        (await ops().pitch(owner.headers, item.pitch.id)).pitch.recovery?.can_retry,
        false,
      );
      await assert.rejects(
        ops().retryRecording(owner.headers, item.pitch.id, randomUUID(), {
          expected_version: 1,
          transcription_attempt: 1,
        }),
        error("recording_retry_unavailable"),
      );
      await ops().changePitch(owner.headers, item.pitch.id, randomUUID(), {}, true);
      await tick();
      assert.equal(await store.exists(item.pitch.id), false);
      providers.submit = async () => ({ state: "rejected" });
      const expired = await upload();
      await tick();
      await admin.query(
        "UPDATE brag.voice_pitch SET created_at=now()-interval '25 hours' WHERE id=$1",
        [expired.pitch.id],
      );
      assert.equal(
        (await ops().pitch(owner.headers, expired.pitch.id)).pitch.recovery?.audio_available,
        false,
      );
      await tick();
      assert.equal(await store.exists(expired.pitch.id), false);
      const missing = await upload();
      await tick();
      await store.remove(missing.pitch.id);
      await assert.rejects(
        ops().retryRecording(owner.headers, missing.pitch.id, randomUUID(), {
          expected_version: 1,
          transcription_attempt: 1,
        }),
        error("recording_unavailable"),
      );
    },
  );
  await t.test("owner, window, contract, revision and HTTP origin are enforced", async () => {
    const item = await upload();
    await tick();
    const payload = { expected_version: 1, transcription_attempt: 1 };
    await assert.rejects(
      ops().retryRecording(other.headers, item.pitch.id, randomUUID(), payload),
      error("draft_unavailable"),
    );
    const oldHeaders = new Headers(owner.headers);
    oldHeaders.delete("x-capture-contract");
    await assert.rejects(
      ops().retryRecording(oldHeaders, item.pitch.id, randomUUID(), payload),
      error("capture_upgrade_required"),
    );
    await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [e.id]);
    await assert.rejects(
      ops().retryRecording(owner.headers, item.pitch.id, randomUUID(), payload),
      error("submissions_closed"),
    );
    await admin.query("UPDATE brag.event SET manually_closed=false WHERE id=$1", [e.id]);
    const handler = projectHandler(auth, db, runtime, config);
    const headers = new Headers(owner.headers);
    headers.set("origin", "https://foreign.test");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", randomUUID());
    assert.equal(
      (
        await handler(
          new Request(runtime.origin + `/api/v1/pitches/${item.pitch.id}/retry`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          }),
        )
      ).status,
      403,
    );
    await ops().changePitch(owner.headers, item.pitch.id, randomUUID(), {}, true);
  });

  await t.test("attempt cap and cancellation serialize against explicit retry", async () => {
    const item = await upload();
    await tick();
    for (let attempt = 1; attempt < 4; attempt++) {
      await ops().retryRecording(owner.headers, item.pitch.id, randomUUID(), {
        expected_version: 1,
        transcription_attempt: attempt,
      });
      await tick();
    }
    assert.equal(
      (await ops().pitch(owner.headers, item.pitch.id)).pitch.recovery?.can_retry,
      false,
    );
    await assert.rejects(
      ops().retryRecording(owner.headers, item.pitch.id, randomUUID(), {
        expected_version: 1,
        transcription_attempt: 4,
      }),
      error("recording_retry_unavailable"),
    );
    const race = await upload();
    await tick();
    await Promise.allSettled([
      ops().retryRecording(owner.headers, race.pitch.id, randomUUID(), {
        expected_version: 1,
        transcription_attempt: 1,
      }),
      ops().changePitch(owner.headers, race.pitch.id, randomUUID(), {}, true),
    ]);
    assert.equal((await ops().pitch(owner.headers, race.pitch.id)).pitch.status, "cancelled");
    await tick();
    assert.equal(await store.exists(race.pitch.id), false);
  });
  await t.test(
    "real capture controller retries the same recording through HTTP and preserves approval",
    async () => {
      const item = await upload();
      await tick();
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.addCookies([
          {
            name: "brag.session_token",
            value: owner.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        const page = await context.newPage();
        await page.goto(f.baseUrl + `/events/${e.id}/submit/${item.draft.id}`);
        await expect(
          page.getByRole("button", { name: "Retry retained recording", exact: true }),
        ).toBeEnabled();
        await page.getByRole("button", { name: "Retry retained recording", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
        ).toBeVisible();
        assert.equal(
          (await db.voicePitch.findUniqueOrThrow({ where: { id: item.pitch.id } }))
            .transcriptionAttempt,
          2,
        );
        providers.submit = async () => ({ state: "accepted", id: randomUUID() });
        await tick();
        await admin.query("UPDATE brag.voice_pitch SET next_attempt=now() WHERE id=$1", [
          item.pitch.id,
        ]);
        await tick();
        await tick();
        await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Recovered", {
          timeout: 15000,
        });
        await page.getByLabel("Project name", { exact: true }).fill("Owner reviewed recovery");
        await page.getByRole("button", { name: "Approve and save draft" }).click();
        await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
        assert.equal(
          (await ops().read(owner.headers, item.draft.id)).draft.fields.title,
          "Owner reviewed recovery",
        );
        await context.close();
      } finally {
        await browser.close();
      }
    },
  );
  await t.test(
    "restored metadata without audio reports unavailable and preserves config receipts",
    async () => {
      const hashesBeforeRestore = (await admin.query(backupSql("b['record_hashes_sql'](9)")))
        .rows[0].json_build_object;
      const restoredUrl = await restoreOwned(f, "brag_restore_recovery");
      const restored = createDatabase(restoredUrl);
      const restoredAdminUrl = new URL(f.adminUrl);
      restoredAdminUrl.pathname = new URL(restoredUrl).pathname;
      const restoredSql = new pg.Client({ connectionString: restoredAdminUrl.toString() });
      await restoredSql.connect();
      try {
        assert.deepEqual(
          (await restoredSql.query(backupSql("b['record_hashes_sql'](9)"))).rows[0]
            .json_build_object,
          hashesBeforeRestore,
        );
        assert.deepEqual(
          (await restoredSql.query(backupSql("b['PITCH_RECOVERY_CHECK_SQL']"))).rows[0]
            .json_build_object,
          recoveryChecks,
        );
        const restoredAuth = createAuth(restored, runtime);
        const restoredOps = projectOperations(
          restoredAuth,
          restored,
          { ...config, audioDirectory: path.join(directory, "missing") },
          runtime.origin,
        );
        const row = (await restoredOps.pitch(owner.headers, first.pitch.id)).pitch;
        assert.equal(row.recovery?.audio_available, false);
        assert.equal(
          (await restored.voicePitch.findUniqueOrThrow({ where: { id: first.pitch.id } }))
            .recoveryConfigVersion,
          2,
        );
        assert.equal(await isDatabaseReady(restored), true);
      } finally {
        await restoredSql.end();
        await restored.$disconnect();
      }
    },
  );
});
