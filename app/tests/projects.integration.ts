import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import type pg from "pg";
import type { BragAuth } from "../src/lib/auth/config.ts";
import type { RuntimeConfig } from "../src/lib/config/runtime.ts";
import type { createDatabase } from "../src/lib/database/client.ts";
import { projectOperations } from "../src/lib/projects/operations.ts";
import { projectHandler } from "../src/lib/projects/handler.ts";
import { sharingOperations } from "../src/lib/sharing/operations.ts";
import { withUser } from "../src/lib/auth/access.ts";
import { agentOperations } from "../src/lib/projects/agent.ts";
import { pitchWorker } from "../src/lib/projects/worker.ts";
import { pitchProviders, type PitchConfig } from "../src/lib/projects/providers.ts";
import { encodeWav } from "../src/projects/audio.ts";
import {
  emptyProject,
  PITCH_POLICY,
  LEGACY_PITCH_POLICY,
  type DraftView,
} from "../src/projects/model.ts";
import { uploadTransportChecks } from "./upload-transport.integration.ts";
import { sharingCaptureChecks } from "./sharing-capture.integration.ts";
import { multilingualPitches } from "./fixtures/multilingual-pitches.ts";
export async function projectChecks(
  t: TestContext,
  fixture: { baseUrl: string; container: string; authFile: string },
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  admin: pg.Client,
  runtime: pg.Client,
  cookie: string,
  otherCookie: string,
  config: RuntimeConfig,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brag-pitch-test-"));
  const pitchConfig: PitchConfig = {
    distillOrigin: "https://distill.example.test",
    distillToken: "fixture-distill",
    anthropicKey: "fixture-claude",
    model: "claude-fixture-20261107",
    audioDirectory: directory,
  };
  const ops = projectOperations(auth, db, pitchConfig),
    agents = agentOperations(auth, db, config.origin),
    handle = projectHandler(auth, db, config, pitchConfig),
    headers = new Headers({ Cookie: cookie, "X-Capture-Contract": "share-work-v1" }),
    other = new Headers({ Cookie: otherCookie, "X-Capture-Contract": "share-work-v1" });
  const eventId = randomUUID(),
    closedId = randomUUID();
  let draft: DraftView;
  const bytes = Buffer.from(encodeWav([new Float32Array(16000).fill(0.1)], 16000));
  const sentences = [
    { ln: 1, sentence: "I built Pitch Demo to share short project descriptions." },
  ];
  let submits = 0,
    structures = 0,
    failClaude = false,
    uncertain = false,
    late: undefined | (() => Promise<void>);
  const provider = pitchProviders(pitchConfig, async (input, init) => {
    const url = String(input);
    if (url === "https://api.anthropic.com/v1/messages") {
      structures++;
      if (late) await late();
      if (failClaude) throw new Error("fixture");
      return Response.json({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              language: "en",
              title: "Pitch Demo",
              problem: "Share projects quickly",
              description: "Short project descriptions from pitches.",
              details: {
                ...emptyProject.details,
                core_idea: "Share a short pitch",
                capabilities: ["Capture a pitch"],
                stack: ["TypeScript"],
                patterns: [
                  {
                    kind: "process",
                    name: "Review before sharing",
                    description: "The author checks the description",
                    evidence: "Described by the speaker",
                  },
                ],
              },
            }),
          },
        ],
      });
    }
    if (init?.method === "POST") {
      submits++;
      if (uncertain) throw new Error("lost acknowledgement");
      return Response.json({ jobId: randomUUID(), status: "queued" }, { status: 202 });
    }
    if (init?.method === "DELETE") return Response.json({ ok: true });
    if (url.includes("/artifacts/")) return Response.json(sentences);
    return Response.json({ id: url.split("/").at(-1), status: "completed" });
  });
  const tick = pitchWorker(db, pitchConfig, provider);
  const advance = async () => {
    await admin.query(
      "UPDATE brag.voice_pitch SET next_attempt=now() WHERE status IN ('queued','transcribing','structure_queued')",
    );
    await tick();
  };
  try {
    await admin.query(
      "INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation) VALUES ($1,'Capture night','Europe/Prague',now(),now()-interval '1 hour',now()+interval '24 hours','approved',1,1),($2,'Closed night','UTC',now(),now()-interval '2 days',now()-interval '1 day','approved',1,1)",
      [eventId, closedId],
    );
    const sharing = sharingOperations(auth, db, config.origin);
    for (const h of [headers, other])
      for (const event of [eventId, closedId])
        await sharing.link(h, randomUUID(), {
          url: config.origin + `/events/${event}`,
          entry_method: "direct_event",
        });
    await t.test(
      "ordinary identity required before choices; event continuation survives Google sign-in",
      async () => {
        const response = await fetch(config.origin + `/events/${eventId}/submit`, {
          redirect: "manual",
        });
        assert.equal(response.status, 307);
        assert.equal(
          new URL(response.headers.get("location")!, config.origin).searchParams.get("return_to"),
          `/events/${eventId}/submit`,
        );
        await assert.rejects(
          ops.create(new Headers(), randomUUID(), { event_id: eventId }),
          (e) => (e as { status: number }).status === 401,
        );
        await assert.rejects(
          ops.create(headers, randomUUID(), { event_id: closedId }),
          /submissions_closed/,
        );
        const key = randomUUID();
        const created = await ops.create(headers, key, { event_id: eventId });
        draft = created.draft;
        assert.deepEqual(
          (await ops.create(headers, key, { event_id: eventId })).receipt,
          created.receipt,
        );
        assert.notEqual(
          (await ops.create(headers, randomUUID(), { event_id: eventId })).draft.id,
          draft.id,
        );
        await assert.rejects(ops.read(other, draft.id), /draft_unavailable/);
        assert.equal(
          await db.platformRole.findUnique({
            where: {
              userId: (await db.projectDraft.findUniqueOrThrow({ where: { id: draft.id } }))
                .ownerId,
            },
          }),
          null,
          "author has no admin role",
        );
      },
    );
    await t.test(
      "draft pagination includes every project with tied creation times and rejects foreign event cursors",
      async () => {
        const owner = (await db.projectDraft.findUniqueOrThrow({ where: { id: draft.id } }))
          .ownerId;
        await db.projectDraft.createMany({
          data: Array.from({ length: 53 }, (_, index) => ({
            id: randomUUID(),
            ownerId: owner,
            eventId: closedId,
            fields: { ...emptyProject, title: `Fixture ${index}` },
          })),
        });
        const page1 = await ops.forEvent(headers, closedId);
        assert.equal(page1.drafts.length, 50);
        assert.ok(page1.next_cursor);
        const page2 = await ops.forEvent(headers, closedId, page1.next_cursor);
        assert.equal(page2.drafts.length, 3);
        assert.equal(page2.next_cursor, null);
        assert.equal(new Set([...page1.drafts, ...page2.drafts].map((row) => row.id)).size, 53);
        await assert.rejects(ops.forEvent(headers, eventId, page1.next_cursor), /invalid_request/);
      },
    );
    await t.test(
      "private typed draft saves optional links, exact retries and versions with server ownership",
      async () => {
        const body = {
            review_source: { method: "typed" },
            expected_version: draft.version,
            fields: {
              ...emptyProject,
              title: "Typed draft",
              project_url: "https://example.test/demo",
              repository_url: "https://codeberg.org/owner/demo",
            },
          },
          key = randomUUID();
        const result = await ops.save(headers, draft.id, key, body);
        draft = result.draft;
        assert.deepEqual((await ops.save(headers, draft.id, key, body)).receipt, result.receipt);
        await assert.rejects(
          ops.save(headers, draft.id, key, { ...body, fields: { ...body.fields, title: "other" } }),
          /idempotency_conflict/,
        );
        await assert.rejects(ops.save(headers, draft.id, randomUUID(), body), /version_conflict/);
        for (const sql of [
          "UPDATE brag.project_draft SET owner_id=owner_id",
          "UPDATE brag.voice_pitch SET draft_id=draft_id",
          "DELETE FROM brag.draft_mutation",
          "UPDATE brag.agent_request SET secret_hash=secret_hash",
        ])
          await assert.rejects(runtime.query(sql), (e) => (e as { code: string }).code === "42501");
        const forbidden = await handle(
          new Request(config.origin + `/api/v1/drafts/${draft.id}`, {
            method: "PATCH",
            headers: {
              Cookie: cookie,
              Origin: "https://evil.test",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        );
        assert.equal(forbidden.status, 403);
      },
    );
    await t.test(
      "voice validates real sample duration before dispatch, persists transcript, and retries Claude without another upload",
      async () => {
        const key = randomUUID();
        await assert.rejects(
          ops.upload(other, draft.id, key, draft.version, PITCH_POLICY, bytes),
          /draft_unavailable/,
        );
        await assert.rejects(
          ops.upload(headers, draft.id, key, draft.version, PITCH_POLICY, Buffer.alloc(960046)),
          /pitch_too_long/,
        );
        assert.equal(submits, 0);
        const accepted = await ops.upload(
          headers,
          draft.id,
          key,
          draft.version,
          PITCH_POLICY,
          bytes,
        );
        assert.equal(
          (await ops.upload(headers, draft.id, key, draft.version, PITCH_POLICY, bytes)).pitch.id,
          accepted.pitch.id,
        );
        failClaude = true;
        await advance();
        await advance();
        await advance();
        let pitch = (await ops.pitch(headers, accepted.pitch.id)).pitch;
        assert.equal(submits, 1);
        assert.equal(pitch.status, "failed");
        assert.match(pitch.transcript, /Pitch Demo/);
        assert.equal((await ops.read(headers, draft.id)).draft.fields.title, "Typed draft");
        failClaude = false;
        await ops.changePitch(headers, pitch.id, randomUUID(), {
          transcript: pitch.transcript + " Corrected name.",
        });
        await advance();
        pitch = (await ops.pitch(headers, pitch.id)).pitch;
        assert.equal(pitch.status, "ready");
        assert.equal(submits, 1);
        assert.equal(structures, 2);
        assert.equal(pitch.proposal?.title, "Pitch Demo");
        assert.ok(!JSON.stringify(pitch).includes("provider_id"));
        const edited = await ops.save(headers, draft.id, randomUUID(), {
          review_source: { method: "typed" },
          expected_version: draft.version,
          fields: { ...draft.fields, title: "My newer text" },
        });
        draft = edited.draft;
        await assert.rejects(
          ops.save(headers, draft.id, randomUUID(), {
            review_source: { method: "typed" },
            expected_version: pitch.base_version,
            fields: { ...draft.fields, ...pitch.proposal },
          }),
          /version_conflict/,
        );
      },
    );
    await t.test(
      "separate pitched projects retain structured proposals, ownership, version and source",
      async () => {
        const first = (await ops.read(headers, draft.id)).draft;
        const another = (await ops.create(headers, randomUUID(), { event_id: eventId })).draft;
        const pitchId = (
          await ops.upload(headers, another.id, randomUUID(), another.version, PITCH_POLICY, bytes)
        ).pitch.id;
        await advance();
        await advance();
        await advance();
        const ready = (await ops.read(headers, another.id)).draft;
        assert.equal(ready.fields.title, "");
        assert.equal(ready.pitch?.status, "ready");
        assert.equal(ready.pitch?.proposal?.details.core_idea, "Share a short pitch");
        assert.equal(ready.pitch?.proposal?.details.patterns[0].source, "author_reported");
        assert.equal(ready.pitch?.proposal?.details.process.agent_share, null);
        const body = {
          expected_version: another.version,
          review_source: { method: "voice", pitch_id: pitchId, attempt: ready.pitch!.attempt },
          fields: { ...ready.fields, ...ready.pitch!.proposal! },
        };
        await assert.rejects(
          ops.save(headers, another.id, randomUUID(), {
            ...body,
            review_source: {
              method: "voice",
              pitch_id: pitchId,
              attempt: ready.pitch!.attempt + 1,
            },
          }),
          /version_conflict/,
        );
        const saved = (await ops.save(headers, another.id, randomUUID(), body)).draft;
        assert.deepEqual(saved.last_edit, {
          method: "voice",
          pitch_id: pitchId,
          approved_pitch: { id: pitchId, attempt: ready.pitch!.attempt },
        });
        assert.equal(saved.fields.schema_version, 1);
        assert.deepEqual((await ops.read(headers, draft.id)).draft.fields, first.fields);
        await assert.rejects(
          ops.save(headers, draft.id, randomUUID(), { ...body, expected_version: first.version }),
          /version_conflict/,
        );
        const all = await ops.forEvent(headers, eventId);
        assert.ok(all.drafts.some((item) => item.id === draft.id));
        assert.ok(all.drafts.some((item) => item.id === another.id && item.title === "Pitch Demo"));
        assert.equal((await ops.forEvent(other, eventId)).drafts.length, 0);
        await assert.rejects(ops.forEvent(other, eventId, another.id), /invalid_request/);
        assert.ok(
          !(await ops.forEvent(headers, eventId, another.id)).drafts.some(
            (item) => item.id === another.id,
          ),
        );
        await assert.rejects(ops.pitch(other, pitchId), /draft_unavailable/);
      },
    );
    await t.test(
      "cancelled jobs reject late Claude output; uncertain Distill dispatch is never blindly resubmitted",
      async () => {
        const accepted = await ops.upload(
          headers,
          draft.id,
          randomUUID(),
          draft.version,
          PITCH_POLICY,
          bytes,
        );
        await advance();
        await advance();
        late = async () => {
          await ops.changePitch(headers, accepted.pitch.id, randomUUID(), {}, true);
        };
        await advance();
        late = undefined;
        const cancelled = (await ops.pitch(headers, accepted.pitch.id)).pitch;
        assert.equal(cancelled.status, "cancelled");
        assert.equal(cancelled.proposal, null);
        assert.equal(cancelled.transcript, "");
        uncertain = true;
        const key = randomUUID(),
          uploaded = await ops.upload(headers, draft.id, key, draft.version, PITCH_POLICY, bytes);
        await advance();
        const calls = submits;
        assert.equal((await ops.pitch(headers, uploaded.pitch.id)).pitch.status, "uncertain");
        await ops.upload(headers, draft.id, key, draft.version, PITCH_POLICY, bytes);
        await advance();
        assert.equal(submits, calls);
        await ops.changePitch(headers, uploaded.pitch.id, randomUUID(), {}, true);
        uncertain = false;
      },
    );
    await t.test(
      "expired dispatch leases remain uncertain and cancelled transcripts do not survive in mutation receipts",
      async () => {
        const owner = await withUser(auth, db, headers, async (_tx, id) => id),
          legacyId = randomUUID(),
          legacyKey = randomUUID();
        await admin.query(
          "INSERT INTO brag.voice_pitch(id,draft_id,owner_id,key,media_hash,base_version,policy,status,legacy_received) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',true)",
          [
            legacyId,
            draft.id,
            owner,
            legacyKey,
            createHash("sha256").update(bytes).digest("hex"),
            draft.version,
            LEGACY_PITCH_POLICY,
          ],
        );
        const oldHeaders = new Headers({ Cookie: cookie });
        const queued = await ops.upload(
          oldHeaders,
          draft.id,
          legacyKey,
          draft.version,
          LEGACY_PITCH_POLICY,
          bytes,
        );
        assert.equal(queued.pitch.id, legacyId);
        await assert.rejects(
          ops.upload(oldHeaders, draft.id, randomUUID(), draft.version, LEGACY_PITCH_POLICY, bytes),
          /capture_upgrade_required/,
        );
        await admin.query(
          "UPDATE brag.voice_pitch SET status='dispatching',lease_until=now()-interval '1 minute' WHERE id=$1",
          [queued.pitch.id],
        );
        const before = submits;
        await advance();
        assert.equal(submits, before);
        assert.equal((await ops.pitch(headers, queued.pitch.id)).pitch.status, "uncertain");
        await ops.changePitch(headers, queued.pitch.id, randomUUID(), {}, true);
        const records = await db.draftMutation.findMany();
        assert.ok(
          records.every((row) => !JSON.stringify(row.result).includes("original_transcript")),
        );
      },
    );
    await t.test(
      "one-proposal agent upload is hash-only, owner-scoped, immutable and source-confirmed",
      async () => {
        const d = (await ops.create(headers, randomUUID(), { event_id: eventId })).draft;
        await assert.rejects(agents.issue(other, d.id, randomUUID(), {}), /draft_unavailable/);
        const key = randomUUID(),
          issued = await agents.issue(headers, d.id, key, {});
        assert.ok("credential" in issued && issued.credential);
        const token = "Bearer " + ("credential" in issued ? issued.credential : "");
        const replay = await agents.issue(headers, d.id, key, {});
        assert.equal("credential" in replay, false);
        assert.equal(
          JSON.stringify(await agents.status(headers, d.id)).includes(token.slice(7)),
          false,
        );
        await assert.rejects(agents.access(token), /capture_upgrade_required/);
        const body = {
            fields: {
              ...emptyProject,
              title: "Agent project",
              language: "sk",
              description: "Projekt v pôvodnom jazyku.",
            },
          },
          uploadKey = randomUUID();
        const receipt = await agents.upload(token, uploadKey, body);
        assert.deepEqual(await agents.upload(token, uploadKey, body), receipt);
        await assert.rejects(agents.upload(token, randomUUID(), body), /proposal_already_received/);
        await assert.rejects(
          agents.upload(token, uploadKey, { fields: { ...body.fields, title: "Changed" } }),
          /proposal_already_received/,
        );
        assert.equal((await ops.read(headers, d.id)).draft.fields.title, "");
        assert.equal(
          (await agents.proposal(headers, d.id)).proposal?.fields &&
            ((await agents.proposal(headers, d.id)).proposal!.fields as { language: string })
              .language,
          "sk",
        );
        await assert.rejects(agents.proposal(other, d.id), /draft_unavailable/);
        assert.equal(
          ((await agents.cancel(headers, d.id, randomUUID())) as { status: string }).status,
          "proposal_received",
        );
        await assert.rejects(
          agents.issue(headers, d.id, randomUUID(), { replace: true }),
          /proposal_already_received/,
        );
        await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [eventId]);
        try {
          assert.deepEqual(await agents.upload(token, uploadKey, body), receipt);
          const saved = await ops.save(headers, d.id, randomUUID(), {
            expected_version: d.version,
            fields: body.fields,
            review_source: { method: "agent", proposal_id: receipt.proposal_id },
          });
          assert.equal(saved.draft.review.state, "confirmed");
          assert.equal(
            (saved.receipt as { operation_class: string }).operation_class,
            "received_completion",
          );
          assert.equal(saved.draft.fields.description, body.fields.description);
          await assert.rejects(agents.issue(headers, d.id, randomUUID(), {}), /saved_project/);
          await ops.save(headers, d.id, randomUUID(), {
            expected_version: saved.draft.version,
            fields: { ...body.fields, title: "Edited after close" },
            review_source: { method: "typed" },
          });
        } finally {
          await admin.query("UPDATE brag.event SET manually_closed=false WHERE id=$1", [eventId]);
        }
        const cancelled = (await ops.create(headers, randomUUID(), { event_id: eventId })).draft;
        const unused = await agents.issue(headers, cancelled.id, randomUUID(), {});
        await agents.cancel(headers, cancelled.id, randomUUID());
        await assert.rejects(
          agents.upload(
            "Bearer " + ("credential" in unused ? unused.credential : ""),
            randomUUID(),
            body,
          ),
          /upload_revoked/,
        );
        await assert.rejects(agents.handoff(headers, d.id), /capture_upgrade_required/);
      },
    );
    await t.test(
      "real agent browser flow cancels replacement credentials, reviews one proposal and saves after closure",
      async () => {
        const browser = await chromium.launch({ headless: true });
        const d = (await ops.create(headers, randomUUID(), { event_id: eventId })).draft;
        try {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
          await context.addCookies(
            cookie.split("; ").map((p) => ({
              name: p.slice(0, p.indexOf("=")),
              value: p.slice(p.indexOf("=") + 1),
              url: config.origin,
            })),
          );
          const page = await context.newPage();
          await page.goto(config.origin + `/events/${eventId}/submit/${d.id}`);
          await page.getByRole("button", { name: /Use your AI agent/ }).click();
          for (let i = 0; i < 2; i++) {
            await expect(page.getByLabel("Agent instruction")).toHaveValue(/Bearer header:/);
            await page.getByRole("button", { name: "Cancel upload instructions" }).click();
            await expect(
              page.getByRole("heading", { name: "Upload instructions cancelled." }),
            ).toBeVisible();
            assert.equal(
              await db.agentProposalUpload.count({ where: { draftId: d.id, revokedAt: null } }),
              0,
            );
            await page.getByRole("button", { name: "Create new instructions" }).click();
          }
          const instruction = await page.getByLabel("Agent instruction").inputValue();
          const token = instruction.match(/Bearer header: ([A-Za-z0-9_-]{43})/)![1];
          const fields = {
            ...structuredClone(emptyProject),
            language: "sk",
            title: "Pôvodný projekt",
            description: "Popis v pôvodnom jazyku.",
          };
          const response = await fetch(config.origin + "/api/v1/agent/proposals", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Idempotency-Key": randomUUID(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields }),
          });
          assert.equal(response.status, 201);
          await expect(page.getByLabel("Project name")).toHaveValue(fields.title, {
            timeout: 12000,
          });
          await page.getByLabel("Project name").fill("Upravený projekt");
          await page.screenshot({
            path: ".localfiles/runtime-evidence/agent-proposal-review-mobile.png",
            fullPage: true,
          });
          await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [eventId]);
          await page.getByRole("button", { name: "Approve and save draft" }).click();
          await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
          await page.goto(config.origin + `/events/${eventId}/submit/${d.id}`);
          await page.getByLabel("Project name").fill("Ďalšia oprava");
          await page.getByRole("button", { name: "Save draft", exact: true }).click();
          await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
          assert.equal((await ops.read(headers, d.id)).draft.fields.title, "Ďalšia oprava");
        } finally {
          await admin.query("UPDATE brag.event SET manually_closed=false WHERE id=$1", [eventId]);
          await browser.close();
        }
      },
    );
    await t.test(
      "mobile capture pauses, counts 30 seconds, retries exact uploads and saves the prefilled form",
      async () => {
        const browser = await chromium.launch({
          headless: true,
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        });
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            permissions: ["microphone"],
          });
          await context.addCookies(
            cookie.split("; ").map((p) => ({
              name: p.slice(0, p.indexOf("=")),
              value: p.slice(p.indexOf("=") + 1),
              url: config.origin,
            })),
          );
          const page = await context.newPage();
          let dropUpload = true,
            dropSave = true;
          const uploads: string[] = [],
            saves: string[] = [];
          await page.route(/\/api\/v1\/(?:drafts|pitches)(?:\/|\?|$)/, async (route) => {
            const req = route.request();
            if (/\/agent-(upload|proposal)$/.test(new URL(req.url()).pathname)) {
              await route.continue();
              return;
            }
            const isUpload = req.method() === "POST" && req.url().endsWith("/pitches"),
              isSave = req.method() === "PATCH";
            if (isUpload) uploads.push(req.headers()["idempotency-key"]);
            if (isSave) saves.push(req.headers()["idempotency-key"]);
            const response = await handle(
              new Request(req.url(), {
                method: req.method(),
                headers: await req.allHeaders(),
                ...(req.method() !== "GET"
                  ? { body: new Uint8Array(req.postDataBuffer() || Buffer.alloc(0)) }
                  : {}),
              }),
            );
            if (isUpload && dropUpload) {
              dropUpload = false;
              await route.abort();
              return;
            }
            if (isSave && dropSave) {
              dropSave = false;
              await route.abort();
              return;
            }
            await route.fulfill({
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: await response.text(),
            });
          });
          await page.goto(config.origin + `/events/${eventId}/submit`);
          await expect(
            page.getByRole("heading", { name: "How would you like to share it?" }),
          ).toBeVisible();
          await page.getByRole("button", { name: /Record your pitch/ }).click();
          await page.getByRole("button", { name: "Start recording", exact: true }).click();
          await expect(page.getByRole("timer")).not.toHaveAttribute(
            "aria-label",
            "0 of 30 seconds recorded",
          );
          await page.getByRole("button", { name: "Pause recording", exact: true }).click();
          await expect(page.getByRole("heading", { name: "Take a breath." })).toBeVisible();
          const paused = await page.getByRole("timer").getAttribute("aria-label");
          await page.waitForTimeout(1200);
          assert.equal(await page.getByRole("timer").getAttribute("aria-label"), paused);
          assert.equal(uploads.length, 0);
          await page.getByRole("button", { name: "Resume recording", exact: true }).click();
          await expect(
            page.getByRole("button", { name: "Retry processing", exact: true }),
          ).toBeVisible({ timeout: 40000 });
          assert.equal(uploads.length, 1);
          await page.getByRole("button", { name: "Retry processing", exact: true }).click();
          await expect.poll(() => uploads.length).toBe(2);
          assert.equal(uploads[0], uploads[1]);
          await expect(
            page.getByRole("heading", { name: "Distill is transcribing your pitch…", exact: true }),
          ).toBeVisible();
          const id = page.url().split("/").at(-1)!;
          assert.equal((await ops.read(headers, id)).draft.pitch!.duration_seconds, 30);
          await advance();
          await advance();
          await advance();
          await expect(
            page.getByRole("heading", { name: "Review your project.", exact: true }),
          ).toBeVisible({ timeout: 15000 });
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Pitch Demo");
          await expect(
            page.getByRole("button", { name: "Start recording", exact: true }),
          ).toHaveCount(0);
          await page.getByLabel("Project name", { exact: true }).fill("Reviewed pitch");
          await page.getByRole("button", { name: "Approve and save draft", exact: true }).click();
          await expect(page.getByRole("alert")).toBeVisible();
          await page.getByRole("button", { name: "Approve and save draft", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "Project saved.", exact: true }),
          ).toBeVisible();
          assert.equal(saves.length, 2);
          assert.equal(saves[0], saves[1]);
          assert.equal((await ops.read(headers, id)).draft.fields.title, "Reviewed pitch");
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({
            path: `.localfiles/runtime-evidence/${fixture.container}-sharing-review-390.png`,
            fullPage: true,
          });
          await page.reload();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
            "Reviewed pitch",
          );
          await page.goto(config.origin + "/my/projects");
          await expect(
            page.getByRole("button", { name: "Reviewed pitch", exact: false }),
          ).toBeVisible();
          await page.goto(config.origin + `/events/${eventId}/submit`);
          await page.getByRole("button", { name: /Type it in/ }).click();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("");
          await page.getByLabel("Project name", { exact: true }).fill("Second independent project");
          await page.getByRole("button", { name: "Save draft", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "Project saved.", exact: true }),
          ).toBeVisible();
          assert.notEqual(page.url().split("/").at(-1), id);
          await context.close();
        } finally {
          await browser.close();
        }
      },
    );
    await t.test(
      "multilingual pitches keep source text and language through processing, acceptance, legacy saves and retries",
      async () => {
        for (const sample of multilingualPitches) {
          let current = (await ops.create(headers, randomUUID(), { event_id: eventId })).draft;
          const pitchId = (
            await ops.upload(
              headers,
              current.id,
              randomUUID(),
              current.version,
              PITCH_POLICY,
              bytes,
            )
          ).pitch.id;
          assert.equal((await ops.pitch(headers, pitchId)).pitch.language, null);
          let output = sample.proposal;
          let dispatches = 0;
          const multilingual = pitchProviders(pitchConfig, async (input, init) => {
            if (String(input) === "https://api.anthropic.com/v1/messages")
              return Response.json({
                stop_reason: "end_turn",
                content: [{ type: "text", text: JSON.stringify(output) }],
              });
            if (init?.method === "POST") {
              dispatches++;
              assert.equal((init.body as FormData).has("targetLanguage"), false);
              return Response.json({ jobId: randomUUID(), status: "queued" }, { status: 202 });
            }
            if (init?.method === "DELETE") return Response.json({ ok: true });
            if (String(input).includes("/artifacts/"))
              return Response.json([{ ln: 1, sentence: sample.transcript }]);
            return Response.json({ id: String(input).split("/").at(-1), status: "completed" });
          });
          const languageTick = pitchWorker(db, pitchConfig, multilingual);
          for (let stage = 0; stage < 3; stage++) {
            await admin.query("UPDATE brag.voice_pitch SET next_attempt=now() WHERE id=$1", [
              pitchId,
            ]);
            await languageTick();
          }
          const ready = (await ops.pitch(headers, pitchId)).pitch;
          assert.equal(ready.status, "ready");
          assert.equal(ready.language, sample.proposal.language);
          assert.equal(ready.original_transcript, sample.transcript);
          assert.equal(ready.transcript, sample.transcript);
          assert.deepEqual(ready.proposal, sample.proposal);
          assert.deepEqual(
            (await db.voicePitch.findUniqueOrThrow({ where: { id: pitchId } })).proposal,
            sample.proposal,
          );
          current = (
            await ops.save(headers, current.id, randomUUID(), {
              expected_version: current.version,
              review_source: { method: "voice", pitch_id: pitchId, attempt: ready.attempt },
              fields: { ...current.fields, ...ready.proposal },
            })
          ).draft;
          assert.deepEqual((await ops.read(headers, current.id)).draft.fields, {
            ...emptyProject,
            ...sample.proposal,
          });
          const missingLanguage = { ...current.fields };
          delete missingLanguage.language;
          await assert.rejects(
            ops.save(headers, current.id, randomUUID(), {
              expected_version: current.version,
              fields: missingLanguage,
              review_source: { method: "typed" },
            }),
            /invalid_fields/,
          );
          await assert.rejects(
            agents.issue(headers, current.id, randomUUID(), {}),
            /saved_project/,
          );
          await assert.rejects(
            ops.changePitch(headers, pitchId, randomUUID(), {
              transcript: multilingualPitches[1].transcript,
            }),
            /version_conflict/,
          );
          await ops.changePitch(headers, pitchId, randomUUID(), {}, true);
          assert.equal((await ops.pitch(headers, pitchId)).pitch.language, null);
          assert.equal(
            (await ops.read(headers, current.id)).draft.fields.language,
            sample.proposal.language,
          );
        }
      },
    );
    await sharingCaptureChecks(t, auth, db, admin, other, pitchConfig, config.origin, eventId);
    await uploadTransportChecks(t, fixture, admin, eventId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
