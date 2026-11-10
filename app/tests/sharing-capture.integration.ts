import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import type pg from "pg";
import type { BragAuth } from "../src/lib/auth/config.ts";
import type { createDatabase } from "../src/lib/database/client.ts";
import { withUser } from "../src/lib/auth/access.ts";
import { projectOperations } from "../src/lib/projects/operations.ts";
import { agentOperations } from "../src/lib/projects/agent.ts";
import { sharingOperations } from "../src/lib/sharing/operations.ts";
import { pitchWorker } from "../src/lib/projects/worker.ts";
import type { PitchConfig, PitchProviders } from "../src/lib/projects/providers.ts";
import { emptyProject, PITCH_POLICY } from "../src/projects/model.ts";
import { fields } from "../src/lib/projects/validation.ts";
import { encodeWav } from "../src/projects/audio.ts";
export async function sharingCaptureChecks(
  t: TestContext,
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  admin: pg.Client,
  headers: Headers,
  config: PitchConfig,
  origin: string,
  eventId: string,
) {
  const ops = projectOperations(auth, db, config, origin),
    agents = agentOperations(auth, db, origin),
    sharing = sharingOperations(auth, db, origin);
  const owner = await withUser(auth, db, headers, async (_tx, id) => id);
  const create = async () => (await ops.create(headers, randomUUID(), { event_id: eventId })).draft;
  const save = (id: string, version: number, title: string) =>
    ops.save(headers, id, randomUUID(), {
      expected_version: version,
      fields: { ...emptyProject, title },
      review_source: { method: "typed" },
    });
  const close = () =>
      admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [eventId]),
    open = () =>
      admin.query("UPDATE brag.event SET manually_closed=false,approval='approved' WHERE id=$1", [
        eventId,
      ]);
  const bytes = Buffer.from(encodeWav([new Float32Array(16000)], 16000));
  await t.test(
    "all capture writers require identity association, fresh contract and an open window; confirmed edits survive closing",
    async () => {
      const fresh = randomUUID();
      await admin.query(
        "INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation) VALUES ($1,'Not linked','UTC',now(),now()-interval '1 hour',now()+interval '1 day','approved',1,1)",
        [fresh],
      );
      await assert.rejects(
        ops.create(headers, randomUUID(), { event_id: fresh }),
        /event_link_required/,
      );
      const old = new Headers(headers);
      old.delete("x-capture-contract");
      await assert.rejects(
        ops.create(old, randomUUID(), { event_id: eventId }),
        /capture_upgrade_required/,
      );
      const empty = await create(),
        confirmed = (await save((await create()).id, 1, "Saved before closing")).draft;
      const capability = await agents.issue(headers, empty.id, randomUUID(), {});
      assert.ok("credential" in capability);
      await close();
      try {
        await assert.rejects(
          ops.create(headers, randomUUID(), { event_id: eventId }),
          /submissions_closed/,
        );
        await assert.rejects(
          save(empty.id, empty.version, "Late first save"),
          /submissions_closed/,
        );
        await assert.rejects(
          ops.upload(headers, empty.id, randomUUID(), empty.version, PITCH_POLICY, bytes),
          /submissions_closed/,
        );
        await assert.rejects(
          agents.upload(
            "Bearer " + ("credential" in capability ? capability.credential : ""),
            randomUUID(),
            { fields: emptyProject },
          ),
          /submissions_closed/,
        );
        const saved = await save(confirmed.id, confirmed.version, "Edited after closing");
        assert.equal(saved.draft.fields.title, "Edited after closing");
        assert.equal(saved.draft.review.state, "confirmed");
        await assert.rejects(
          ops.discard(headers, saved.draft.id, randomUUID(), {
            expected_version: saved.draft.version,
          }),
          /saved_project/,
        );
        const key = randomUUID(),
          body = { expected_version: empty.version };
        const receipt = await ops.discard(headers, empty.id, key, body);
        assert.deepEqual(await ops.discard(headers, empty.id, key, body), receipt);
        await assert.rejects(ops.read(headers, empty.id), /draft_unavailable/);
        assert.equal(
          (await sharing.projects(headers, {})).projects.some((p) => p.id === empty.id),
          false,
        );
        await admin.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [eventId]);
        await assert.rejects(
          save(confirmed.id, saved.draft.version, "Suspended"),
          /event_suspended/,
        );
      } finally {
        await open();
      }
    },
  );
  await t.test(
    "exact legacy save receipts remain readable but cannot authorize a fresh mutation",
    async () => {
      const draft = await create(),
        old = new Headers(headers);
      old.delete("x-capture-contract");
      const key = randomUUID(),
        body = { expected_version: 1, fields: { ...emptyProject, title: "Historical receipt" } };
      await save(draft.id, draft.version, "Historical receipt");
      const hash = createHash("sha256")
        .update(JSON.stringify(["save", draft.id, 1, fields(body.fields), null]))
        .digest("hex");
      await admin.query(
        "INSERT INTO brag.draft_mutation(actor_id,key,intent_hash,result) VALUES ($1,$2,$3,$4)",
        [owner, key, hash, { draft: { id: draft.id, version: 2, fields: body.fields } }],
      );
      assert.equal((await ops.save(old, draft.id, key, body)).draft.id, draft.id);
      await assert.rejects(ops.save(old, draft.id, randomUUID(), body), /capture_upgrade_required/);
      await assert.rejects(
        ops.save(old, draft.id, key, { ...body, fields: { ...body.fields, title: "Different" } }),
        /idempotency_conflict/,
      );
    },
  );
  await t.test(
    "racing agent proposal and owner save never overwrite one another; confirmation revokes unused capabilities",
    async () => {
      for (let n = 0; n < 3; n++) {
        const draft = await create(),
          issued = await agents.issue(headers, draft.id, randomUUID(), {}),
          token = "Bearer " + ("credential" in issued ? issued.credential : "");
        const outcomes = await Promise.allSettled([
          agents.upload(token, randomUUID(), { fields: { ...emptyProject, title: "Proposal" } }),
          save(draft.id, draft.version, "Owner text"),
        ]);
        assert.equal(outcomes[1].status, "fulfilled");
        assert.equal((await ops.read(headers, draft.id)).draft.fields.title, "Owner text");
        const received = (await agents.proposal(headers, draft.id)).proposal;
        if (outcomes[0].status === "fulfilled") {
          assert.ok(received);
          assert.equal(received.accepted_version, null);
        } else {
          assert.equal(received, null);
          await assert.rejects(
            agents.upload(token, randomUUID(), { fields: emptyProject }),
            /upload_revoked/,
          );
        }
      }
    },
  );
  await t.test(
    "late provider acknowledgements cross lease, transcription and retention deadlines without reviving work",
    async () => {
      // This account is separate from the earlier capture quota fixtures.
      for (const boundary of ["lease", "transcription", "retention"]) {
        const draft = await create(),
          queued = await ops.upload(
            headers,
            draft.id,
            randomUUID(),
            draft.version,
            PITCH_POLICY,
            bytes,
          ),
          id = queued.pitch.id;
        let calls = 0;
        const providerId = randomUUID();
        const providers: PitchProviders = {
          model: config.model,
          submit: async () => {
            calls++;
            await admin.query(
              boundary === "lease"
                ? "UPDATE brag.voice_pitch SET lease_until=now()-interval '1 second' WHERE id=$1"
                : boundary === "transcription"
                  ? "UPDATE brag.voice_pitch SET created_at=now()-interval '16 minutes' WHERE id=$1"
                  : "UPDATE brag.voice_pitch SET created_at=now()-interval '31 days' WHERE id=$1",
              [id],
            );
            return { state: "accepted", id: providerId };
          },
          poll: async () => ({ status: "completed" }),
          artifact: async () => [],
          remove: async () => {},
          structure: async () => ({
            language: "en",
            title: "Never",
            problem: "",
            description: "",
            details: structuredClone(emptyProject.details),
          }),
        };
        await pitchWorker(db, config, providers)();
        const row = await db.voicePitch.findUniqueOrThrow({ where: { id } });
        assert.equal(calls, 1);
        assert.equal(row.providerId, providerId);
        assert.equal(row.cleanupPending, true);
        assert.ok(["uncertain", "cancelled"].includes(row.status));
        assert.equal(row.proposal, null);
        assert.equal(row.transcript, "");
        await ops.changePitch(headers, id, randomUUID(), {}, true);
      }
    },
  );
  await t.test(
    "voice received while live can be confirmed after close; stale or cancelled attempts cannot",
    async () => {
      const draft = await create(),
        queued = await ops.upload(
          headers,
          draft.id,
          randomUUID(),
          draft.version,
          PITCH_POLICY,
          bytes,
        ),
        id = queued.pitch.id;
      const proposal = {
        language: "cs",
        title: "Český projekt",
        problem: "Problém",
        description: "Popis bez překladu.",
        details: structuredClone(emptyProject.details),
      };
      await admin.query(
        "UPDATE brag.voice_pitch SET status='ready',proposal=$2,transcript='Český projekt',attempts=1 WHERE id=$1",
        [id, proposal],
      );
      await close();
      try {
        await assert.rejects(
          ops.changePitch(headers, id, randomUUID(), { transcript: "Retry after close" }),
          /submissions_closed/,
        );
        await assert.rejects(
          ops.save(headers, draft.id, randomUUID(), {
            expected_version: draft.version,
            fields: { ...emptyProject, ...proposal },
            review_source: { method: "voice", pitch_id: id, attempt: 2 },
          }),
          /version_conflict/,
        );
        const saved = await ops.save(headers, draft.id, randomUUID(), {
          expected_version: draft.version,
          fields: { ...emptyProject, ...proposal },
          review_source: { method: "voice", pitch_id: id, attempt: 1 },
        });
        assert.equal(saved.draft.fields.language, "cs");
        assert.equal(saved.draft.review.attention, null);
      } finally {
        await open();
      }
    },
  );
}
