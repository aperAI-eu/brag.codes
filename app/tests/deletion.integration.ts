import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  ownedFixture,
  bootstrapSchema7,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { identity, event, draft, agent, pitch } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { deletionOperations } from "../src/lib/deletion/operations.ts";
import { exportDeletionLedger, replayDeletionLedger } from "../src/lib/deletion/recovery.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { publicationHandler } from "../src/lib/publication/handler.ts";
import { publicProject, publicEventProjects } from "../src/lib/publication/reads.ts";
import { draftOperations } from "../src/lib/projects/drafts.ts";
import { pitchWorker } from "../src/lib/projects/worker.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";
import { emptyProject } from "../src/projects/model.ts";
const code = (status: number) => (e: { status?: number }) => e.status === status;

test("owner deletion, immutable receipts, cleanup and independent restore ledger", async (t) => {
  const f = await ownedFixture();
  await bootstrapSchema7(f);
  const admin = new pg.Client({ connectionString: f.adminUrl }),
    runtime = new pg.Client({ connectionString: f.runtimeUrl });
  await Promise.all([admin.connect(), runtime.connect()]);
  const db = createDatabase(f.runtimeUrl);
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
    await runtime.end();
  });
  const config = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
  };
  const owner = await identity(admin, config.authSecret),
    other = await identity(admin, config.authSecret),
    e = await event(admin);
  const privateId = await draft(admin, owner.owner, e.id, "confirmed"),
    otherId = await draft(admin, other.owner, e.id, "confirmed");
  const sharingCheck = spawnSync(
    "python3",
    [
      "-c",
      "import runpy; print(runpy.run_path('deploy/runtime/backup-guest.py')['SHARING_CHECK_SQL'])",
    ],
    { encoding: "utf8" },
  );
  assert.equal(sharingCheck.status, 0);
  const sharingIntegrity = async (client = admin) =>
    (await client.query(sharingCheck.stdout)).rows[0].json_build_object.sharingIntegrity;
  assert.equal(await sharingIntegrity(), true, "recovery check supports pre-deletion schemas");
  const upgrade = migrateCandidate(f);
  assert.equal(upgrade.status, 0, upgrade.output);
  const auth = createAuth(db, config),
    ops = deletionOperations(auth, db),
    drafts = draftOperations(auth, db, config.origin, false),
    pub = publicationOperations(auth, db, config.origin),
    handler = publicationHandler(auth, db, config);
  const key = randomUUID(),
    intent = { expected_version: 2, expected_published: false };
  await t.test(
    "migration preserves rows and runtime cannot forge ledger or invoke purge",
    async () => {
      assert.equal(await isDatabaseReady(db), true);
      assert.equal(
        (await admin.query("SELECT count(*)::int n FROM brag.project_draft")).rows[0].n,
        2,
      );
      for (const sql of [
        "DELETE FROM brag.project_deletion",
        `SELECT brag.purge_deleted_project('${privateId}')`,
        `INSERT INTO brag.project_deletion(project_id,owner_id,key,expected_version,expected_published) VALUES('${privateId}','${owner.owner}','${key}',2,false)`,
      ])
        await assert.rejects(() => runtime.query(sql));
    },
  );
  await t.test(
    "direct callers and HTTP require ownership and same-origin browser authority",
    async () => {
      await assert.rejects(() => ops.remove(other.headers, privateId, key, intent), code(404));
      await assert.rejects(() => ops.remove(new Headers(), privateId, key, intent), code(401));
      const headers = new Headers(owner.headers);
      headers.set("origin", "https://foreign.example");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      const response = await handler(
        new Request(`${config.origin}/api/v1/projects/${privateId}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify(intent),
        }),
      );
      assert.equal(response.status, 403);
      await assert.rejects(
        () => ops.remove(owner.headers, privateId, key, { ...intent, owner_id: other.owner }),
        code(400),
      );
      await assert.rejects(
        () => ops.remove(owner.headers, privateId, key, { ...intent, expected_version: 1 }),
        code(409),
      );
      assert.equal(
        (await drafts.read(owner.headers, privateId)).draft.fields.description,
        "secret-description",
      );
    },
  );
  await t.test(
    "delete clears saved content; exact concurrent retries return one receipt",
    async () => {
      await admin.query(
        "UPDATE brag.event SET manually_closed=true,approval='suspended' WHERE id=$1",
        [e.id],
      );
      const [a, b] = await Promise.all([
        ops.remove(owner.headers, privateId, key, intent),
        ops.remove(owner.headers, privateId, key, intent),
      ]);
      assert.deepEqual(a, b);
      assert.equal(a.deleted, true);
      assert.equal(JSON.stringify(a).includes("secret-description"), false);
      assert.deepEqual(await ops.receipt(owner.headers, privateId, key), a);
      await assert.rejects(() => ops.receipt(other.headers, privateId, key), code(404));
      await assert.rejects(
        () => ops.remove(owner.headers, privateId, key, { ...intent, expected_published: true }),
        code(409),
      );
      await assert.rejects(() => drafts.read(owner.headers, privateId), code(404));
      const cleared = (
        await admin.query("SELECT fields,last_edit FROM brag.project_draft WHERE id=$1", [
          privateId,
        ])
      ).rows[0];
      assert.deepEqual(cleared.fields, emptyProject);
      assert.deepEqual(cleared.last_edit, {});
      await assert.rejects(() =>
        runtime.query(
          "UPDATE brag.project_draft SET fields=jsonb_set(fields,'{title}','\"revived\"') WHERE id=$1",
          [privateId],
        ),
      );
      assert.equal(
        (await drafts.read(other.headers, otherId)).draft.fields.description,
        "secret-description",
      );
      await admin.query(
        "UPDATE brag.event SET manually_closed=false,approval='approved' WHERE id=$1",
        [e.id],
      );
    },
  );
  await t.test(
    "backup accepts a deleted confirmed project but rejects an invalid discard",
    async () => {
      assert.equal(await sharingIntegrity(), true);
      await admin.query("BEGIN");
      try {
        // Corrupt only an owned disposable fixture, then roll back its DDL and data.
        await admin.query(
          "ALTER TABLE brag.project_draft DROP CONSTRAINT project_draft_discard; ALTER TABLE brag.project_draft DISABLE TRIGGER USER",
        );
        await admin.query("UPDATE brag.project_draft SET discarded_at=now() WHERE id=$1", [
          otherId,
        ]);
        assert.equal(await sharingIntegrity(), false);
      } finally {
        await admin.query("ROLLBACK");
      }
      assert.equal(await sharingIntegrity(), true);
    },
  );
  let publishedId: string;
  let restoredUrl: string;
  await t.test(
    "published deletion removes snapshots, contact, appearances and rejects stale confirmation",
    async () => {
      publishedId = await draft(admin, owner.owner, e.id, "confirmed");
      await admin.query("UPDATE brag.project_draft SET fields=fields||$2::jsonb WHERE id=$1", [
        publishedId,
        JSON.stringify({
          title: "Published example",
          problem: "A real problem",
          description: "Public example",
        }),
      ]);
      const r = await pub.prepare(owner.headers, publishedId, randomUUID(), {
        expected_version: 2,
        public_author: {
          display_name: "Owner",
          contact: { kind: "email", value: "public@example.test" },
        },
        include: { project_link: false, repository_link: false, details: false },
      });
      // A pre-publication confirmation must not silently delete the newly public state.
      await pub.publish(owner.headers, publishedId, randomUUID(), { review_id: r.review_id });
      await assert.rejects(
        () => ops.remove(owner.headers, publishedId, randomUUID(), intent),
        code(409),
      );
      assert.equal(
        (await publicProject(db, publishedId)).content.author.contact,
        "public@example.test",
      );
      restoredUrl = await restoreOwned(f, "brag_restore_deletion"); // intentionally before deletion
      const headers = new Headers(owner.headers);
      headers.set("origin", config.origin);
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", randomUUID());
      const response = await handler(
        new Request(`${config.origin}/api/v1/projects/${publishedId}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ ...intent, expected_published: true }),
        }),
      );
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      await assert.rejects(() => publicProject(db, publishedId), code(404));
      assert.equal(
        (await publicEventProjects(db, e.id)).projects.some((p) => p.id === publishedId),
        false,
      );
      for (const table of [
        "project_public_state",
        "project_publication",
        "publication_review",
        "publication_mutation",
        "event_appearance",
      ])
        assert.equal(
          (
            await admin.query(`SELECT count(*)::int n FROM brag.${table} WHERE project_id=$1`, [
              publishedId,
            ])
          ).rows[0].n,
          0,
        );
    },
  );
  await t.test(
    "latest independent ledger suppresses deleted content in an older restore, with transactional conflict refusal",
    async () => {
      const ledger = await exportDeletionLedger(admin, "local");
      const url = new URL(restoredUrl);
      url.username = new URL(f.adminUrl).username;
      url.password = new URL(f.adminUrl).password;
      const restored = new pg.Client({ connectionString: url.toString() });
      await restored.connect();
      try {
        assert.equal(
          (
            await restored.query(
              "SELECT count(*)::int n FROM brag.project_publication WHERE project_id=$1",
              [publishedId],
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(() => replayDeletionLedger(restored, ledger, "test"));
        await replayDeletionLedger(restored, ledger, "local");
        await replayDeletionLedger(restored, ledger, "local");
        assert.equal(
          (
            await restored.query(
              "SELECT count(*)::int n FROM brag.project_publication WHERE project_id=$1",
              [publishedId],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(await sharingIntegrity(restored), true, "restored deletion remains qualified");
        const bad = structuredClone(ledger);
        bad.deletions[0].expected_version++;
        await assert.rejects(() => replayDeletionLedger(restored, bad, "local"));
        assert.deepEqual(
          (await exportDeletionLedger(restored, "local")).deletions,
          ledger.deletions,
        );
      } finally {
        await restored.end();
      }
    },
  );
  await t.test(
    "agent proposals and pitch content are cleared and audio cleanup runs after deletion",
    async () => {
      const id = await draft(admin, owner.owner, e.id, "confirmed");
      await agent(admin, owner.owner, e.id, id);
      const pitchId = await pitch(admin, owner.owner, id, "ready");
      const audioDirectory = path.join(path.dirname(f.authFile), "deletion-audio");
      await mkdir(audioDirectory, { recursive: true });
      await writeFile(path.join(audioDirectory, pitchId + ".wav"), "fixture");
      await ops.remove(owner.headers, id, randomUUID(), intent);
      assert.equal(
        (await admin.query("SELECT fields FROM brag.agent_proposal WHERE draft_id=$1", [id]))
          .rows[0].fields,
        null,
      );
      assert.ok(
        (
          await admin.query("SELECT revoked_at FROM brag.agent_proposal_upload WHERE draft_id=$1", [
            id,
          ])
        ).rows[0].revoked_at,
      );
      const removed: string[] = [];
      await pitchWorker(db, { audioDirectory }, {
        remove: async (id: string) => {
          removed.push(id);
        },
      } as never)();
      assert.deepEqual(removed, ["secret-provider-id"]);
      await assert.rejects(() => access(path.join(audioDirectory, pitchId + ".wav")));
      const row = (
        await admin.query(
          "SELECT status,transcript,proposal,cleanup_pending FROM brag.voice_pitch WHERE id=$1",
          [pitchId],
        )
      ).rows[0];
      assert.equal(row.status, "cancelled");
      assert.equal(row.transcript, "");
      assert.equal(row.proposal, null);
      assert.equal(row.cleanup_pending, false);
    },
  );
  await t.test("late in-flight structure result cannot restore deleted content", async () => {
    const id = await draft(admin, owner.owner, e.id, "confirmed");
    const pitchId = await pitch(admin, owner.owner, id, "structure_queued");
    let started!: () => void, finish!: () => void;
    const entering = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finishing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const work = pitchWorker(
      db,
      { audioDirectory: path.join(path.dirname(f.authFile), "late-deletion-audio") },
      {
        model: "fixture",
        remove: async () => {},
        structure: async () => {
          started();
          await finishing;
          return { ...emptyProject, title: "Must not return" };
        },
      } as never,
    )();
    await entering;
    try {
      await ops.remove(owner.headers, id, randomUUID(), intent);
    } finally {
      finish();
    }
    await work;
    const row = (
      await admin.query("SELECT status,proposal,transcript FROM brag.voice_pitch WHERE id=$1", [
        pitchId,
      ])
    ).rows[0];
    assert.equal(row.status, "cancelled");
    assert.equal(row.proposal, null);
    assert.equal(row.transcript, "");
    await assert.rejects(() => drafts.read(owner.headers, id), code(404));
  });
  await t.test("failed purge rolls back ledger/content and exact retry succeeds", async () => {
    const id = await draft(admin, owner.owner, e.id, "confirmed"),
      requestKey = randomUUID();
    await admin.query(
      "CREATE FUNCTION public.reject_deletion_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'fixture purge failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_deletion_fixture BEFORE UPDATE ON brag.project_draft FOR EACH ROW EXECUTE FUNCTION public.reject_deletion_fixture()",
    );
    try {
      await assert.rejects(() => ops.remove(owner.headers, id, requestKey, intent));
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM brag.project_deletion WHERE project_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await drafts.read(owner.headers, id)).draft.fields.description,
        "secret-description",
      );
    } finally {
      await admin.query(
        "DROP TRIGGER reject_deletion_fixture ON brag.project_draft; DROP FUNCTION public.reject_deletion_fixture()",
      );
    }
    assert.equal((await ops.remove(owner.headers, id, requestKey, intent)).deleted, true);
  });
  await t.test(
    "concurrent save and deletion cannot both commit against the same version",
    async () => {
      const id = await draft(admin, owner.owner, e.id, "confirmed");
      const headers = new Headers(owner.headers);
      headers.set("X-Capture-Contract", "share-work-v1");
      const results = await Promise.allSettled([
        drafts.save(headers, id, randomUUID(), {
          expected_version: 2,
          fields: { ...emptyProject, title: "Newer content" },
          review_source: { method: "typed" },
        }),
        ops.remove(owner.headers, id, randomUUID(), intent),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find((r) => r.status === "rejected");
      assert.ok(
        rejected && rejected.status === "rejected" && [404, 409].includes(rejected.reason.status),
      );
    },
  );
});
