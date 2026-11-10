import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";
import {
  ownedFixture,
  bootstrapSchema14,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { identity, event, association, draft as fixtureDraft } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { projectOperations } from "../src/lib/projects/operations.ts";
import { agentOperations } from "../src/lib/projects/agent.ts";
import { sharingOperations } from "../src/lib/sharing/operations.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { publicProject, publicEventProjects } from "../src/lib/publication/reads.ts";
import { galleryProjects } from "../src/lib/gallery/reads.ts";
import { emptyProject, PITCH_POLICY } from "../src/projects/model.ts";
import { encodeWav } from "../src/projects/audio.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";
import { safeReturn } from "../src/lib/auth/handler.ts";
import { pitchWorker } from "../src/lib/projects/worker.ts";
import { moderationOperations } from "../src/lib/moderation/operations.ts";

const error = (code: string) => (e: { code?: string }) => e.code === code;
const status = (n: number) => (e: { status?: number }) => e.status === n;
const sql = (expr: string) =>
  execFileSync(
    "python3",
    ["-c", "import runpy; m=runpy.run_path('deploy/runtime/backup-guest.py'); print(" + expr + ")"],
    { encoding: "utf8" },
  );
const fields = {
  ...emptyProject,
  language: "en",
  title: "Independent project",
  problem: "Tools are hard to find",
  description: "A shared tool directory",
};
const selection = {
  public_author: {
    display_name: "Author",
    contact: { kind: "profile", value: "https://example.test/author" },
  },
  include: { project_link: false, repository_link: false, details: false },
};

test("optional event migration, ownership, capture, publication and restore", async (t) => {
  const f = await ownedFixture();
  await bootstrapSchema14(f);
  const admin = new pg.Client({ connectionString: f.adminUrl }),
    runtime = new pg.Client({ connectionString: f.runtimeUrl });
  await admin.connect();
  await runtime.connect();
  const db = createDatabase(f.runtimeUrl);
  t.after(async () => {
    await db.$disconnect();
    await runtime.end();
    await admin.end();
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
  owner.headers.set("x-capture-contract", "share-work-v1");
  other.headers.set("x-capture-contract", "share-work-v1");
  const existing = await fixtureDraft(admin, owner.owner, e.id, "confirmed");
  const before = (await admin.query(sql("m['record_hashes_sql'](14)"))).rows[0].json_build_object
    .recordHashes;
  await t.test("failed optional-event upgrade leaves schema and data intact", async () => {
    const migrator = new pg.Client({ connectionString: f.migrationUrl });
    await migrator.connect();
    try {
      const migration = await readFile(
        "app/prisma/migrations/202611100015_optional_events/migration.sql",
        "utf8",
      );
      await assert.rejects(
        migrator.query(migration.replace("COMMIT;", "SELECT 1/0; COMMIT;")),
        /division by zero/,
      );
      await migrator.query("ROLLBACK");
      assert.equal(
        (await admin.query("SELECT schema_version FROM brag.runtime_metadata")).rows[0]
          .schema_version,
        14,
      );
      assert.deepEqual(
        (await admin.query(sql("m['record_hashes_sql'](14)"))).rows[0].json_build_object
          .recordHashes,
        before,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM pg_attribute WHERE attrelid='brag.project_draft'::regclass AND attname='event_scope' AND NOT attisdropped",
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await migrator.end();
    }
  });
  const migration = migrateCandidate(f);
  assert.equal(migration.status, 0, migration.output);
  const after = (await admin.query(sql("m['record_hashes_sql'](15)"))).rows[0].json_build_object
    .recordHashes;
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, k);
  assert.equal(await isDatabaseReady(db), true);
  const auth = createAuth(db, config),
    ops = projectOperations(auth, db, null, config.origin),
    agent = agentOperations(auth, db, config.origin),
    sharing = sharingOperations(auth, db, config.origin),
    pub = publicationOperations(auth, db, config.origin);
  let id = "",
    version = 1;
  await t.test("explicit null, owner-only access, idempotency and immutable context", async () => {
    for (const input of [{}, { event_id: "" }, { event_id: "none" }, { event_id: 0 }])
      await assert.rejects(
        ops.create(owner.headers, randomUUID(), input),
        error("invalid_request"),
      );
    await assert.rejects(ops.create(new Headers(), randomUUID(), { event_id: null }), status(401));
    const key = randomUUID(),
      created = await ops.create(owner.headers, key, { event_id: null });
    id = created.draft.id;
    assert.equal(created.draft.event, null);
    assert.equal(created.draft.event_id, null);
    assert.equal(created.draft.can_submit, true);
    assert.equal((await ops.create(owner.headers, key, { event_id: null })).draft.id, id);
    await assert.rejects(
      ops.create(owner.headers, key, { event_id: e.id }),
      error("idempotency_conflict"),
    );
    await assert.rejects(ops.read(other.headers, id), status(404));
    await assert.rejects(agent.issue(other.headers, id, randomUUID(), {}), status(404));
    await assert.rejects(
      admin.query("UPDATE brag.project_draft SET event_id=NULL WHERE id=$1", [existing]),
      error("23514"),
    );
    await assert.rejects(
      runtime.query("UPDATE brag.project_draft SET event_id=$2 WHERE id=$1", [id, e.id]),
      error("42501"),
    );
    assert.equal(safeReturn("/submit/" + id), "/submit/" + id);
    assert.equal(safeReturn("/submit"), "\/submit");
  });
  await t.test(
    "typed save and history include no-event work, event filters exclude it",
    async () => {
      const saved = await ops.save(owner.headers, id, randomUUID(), {
        expected_version: 1,
        fields,
        review_source: { method: "typed" },
      });
      version = saved.draft.version;
      assert.equal(saved.draft.can_edit_saved, true);
      const list = await sharing.projects(owner.headers);
      assert.equal(list.projects.find((p) => p.id === id)?.event, null);
      assert.equal(
        (await sharing.projects(other.headers)).projects.some((p) => p.id === id),
        false,
      );
      assert.equal(
        (await sharing.projects(owner.headers, { event_id: e.id })).projects.some(
          (p) => p.id === id,
        ),
        false,
      );
      assert.equal((await ops.read(owner.headers, existing)).draft.event?.id, e.id);
    },
  );
  await t.test("no-event agent receives one scoped proposal and owner approves it", async () => {
    const d = (await ops.create(owner.headers, randomUUID(), { event_id: null })).draft;
    const grant = await agent.issue(owner.headers, d.id, randomUUID(), {});
    assert.ok("credential" in grant);
    const token = "Bearer " + grant.credential,
      key = randomUUID();
    const received = await agent.upload(token, key, { fields });
    assert.equal(received.review_url, config.origin + "/submit/" + d.id);
    assert.deepEqual(await agent.upload(token, key, { fields }), received);
    await assert.rejects(
      agent.upload(token, randomUUID(), { fields }),
      error("proposal_already_received"),
    );
    await assert.rejects(
      ops.save(other.headers, d.id, randomUUID(), {
        expected_version: 1,
        fields,
        review_source: { method: "agent", proposal_id: received.proposal_id },
      }),
      status(404),
    );
    assert.equal(
      (
        await ops.save(owner.headers, d.id, randomUUID(), {
          expected_version: 1,
          fields,
          review_source: { method: "agent", proposal_id: received.proposal_id },
        })
      ).draft.review.confirmed_version,
      2,
    );
    await assert.rejects(
      runtime.query(
        "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash) VALUES($1,$2,$3,NULL,1,$4)",
        [randomUUID(), d.id, other.owner, "c".repeat(64)],
      ),
      error("23503"),
    );
    await assert.rejects(
      runtime.query(
        "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash) VALUES($1,$2,$3,$4,1,$5)",
        [randomUUID(), d.id, owner.owner, e.id, "d".repeat(64)],
      ),
      error("23503"),
    );
  });
  await t.test("voice intake accepts no event, keeps ownership and records admission", async () => {
    const pitchConfig = {
      audioDirectory: process.env.BRAG_PITCH_AUDIO_DIR!,
      distillOrigin: "https://example.test",
      distillToken: "fixture",
      anthropicKey: "fixture",
      model: "fixture",
    };
    const voice = projectOperations(auth, db, pitchConfig, config.origin),
      d = (await ops.create(owner.headers, randomUUID(), { event_id: null })).draft;
    const bytes = Buffer.from(encodeWav([new Float32Array(16000)], 16000));
    await assert.rejects(
      voice.preflight(other.headers, d.id, randomUUID(), 1, PITCH_POLICY),
      status(404),
    );
    const key = randomUUID(),
      result = await voice.upload(owner.headers, d.id, key, 1, PITCH_POLICY, bytes);
    assert.ok(result.pitch.id);
    assert.equal(
      (await voice.upload(owner.headers, d.id, key, 1, PITCH_POLICY, bytes)).pitch.id,
      result.pitch.id,
    );
    assert.equal(
      (await admin.query("SELECT event_id FROM brag.project_admission WHERE project_id=$1", [d.id]))
        .rows[0].event_id,
      null,
    );
    const tick = pitchWorker(db, pitchConfig, {
      model: "fixture",
      submit: async () => ({ state: "accepted", id: randomUUID() }),
      poll: async () => ({ status: "completed" }),
      artifact: async () => [{ ln: 1, sentence: "A shared tool directory." }],
      remove: async () => {},
      structure: async () => fields,
    });
    await tick();
    await admin.query("UPDATE brag.voice_pitch SET next_attempt=now() WHERE id=$1", [
      result.pitch.id,
    ]);
    await tick();
    await tick();
    const ready = (await voice.pitch(owner.headers, result.pitch.id)).pitch;
    assert.equal(ready.status, "ready");
    assert.equal((await ops.read(owner.headers, d.id)).draft.fields.title, "");
    const saved = await voice.save(owner.headers, d.id, randomUUID(), {
      expected_version: 1,
      fields,
      review_source: { method: "voice", pitch_id: result.pitch.id, attempt: ready.attempt },
    });
    assert.equal(saved.draft.event_id, null);
    assert.equal(saved.draft.review.confirmed_version, 2);
  });
  await t.test(
    "publish without event, reject forged review binding, withdraw and republish",
    async () => {
      const review = await pub.prepare(owner.headers, id, randomUUID(), {
        expected_version: version,
        ...selection,
      });
      assert.equal(review.public_project.event, null);
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.publication_review(id,project_id,owner_id,event_id,draft_version,publication_version,projection,projection_hash,selection,created_at,expires_at) SELECT $1,project_id,$2,NULL,draft_version,publication_version,projection,projection_hash,selection,created_at,expires_at FROM brag.publication_review WHERE id=$3",
          [randomUUID(), other.owner, review.review_id],
        ),
        error("23503"),
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.project_publication(id,project_id,owner_id,event_id,version,draft_version,review_id,projection,projection_hash) SELECT $1,project_id,$2,NULL,publication_version,draft_version,id,projection,projection_hash FROM brag.publication_review WHERE id=$3",
          [randomUUID(), other.owner, review.review_id],
        ),
        error("23503"),
      );
      await assert.rejects(
        pub.publish(other.headers, id, randomUUID(), { review_id: review.review_id }),
        status(404),
      );
      const receipt = await pub.publish(owner.headers, id, randomUUID(), {
        review_id: review.review_id,
      });
      assert.equal(receipt.event_url, null);
      assert.equal((await publicProject(db, id)).event_id, null);
      assert.equal(
        (await galleryProjects(db, new URLSearchParams(), config.origin)).projects.find(
          (p) => p.id === id,
        )?.event,
        null,
      );
      assert.equal(
        (await publicEventProjects(db, e.id, new URLSearchParams())).projects.some(
          (p) => p.id === id,
        ),
        false,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM brag.event_appearance WHERE project_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
      );
      await pub.withdraw(owner.headers, id, randomUUID(), {
        expected_version: version,
        expected_publication_revision: 1,
      });
      await assert.rejects(publicProject(db, id), status(404));
      const d = (await ops.read(owner.headers, id)).draft;
      const again = await pub.prepare(owner.headers, id, randomUUID(), {
        expected_version: d.version,
        expected_publication_revision: 2,
        ...selection,
      });
      await pub.publish(owner.headers, id, randomUUID(), { review_id: again.review_id });
      assert.equal((await publicProject(db, id)).publication_version, 2);
    },
  );
  await t.test("no-event publications remain subject to global admin moderation", async () => {
    const moderator = await identity(admin, config.authSecret);
    await admin.query(
      'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES($1,true,1,now())',
      [moderator.owner],
    );
    const mod = moderationOperations(auth, db);
    assert.equal((await mod.detail(moderator.headers, id)).event_id, null);
    const input = { action: "hide", expected_revision: 3, reason: "Review publication" };
    await assert.rejects(mod.mutate(owner.headers, id, randomUUID(), input), status(403));
    await mod.mutate(moderator.headers, id, randomUUID(), input);
    await assert.rejects(publicProject(db, id), status(404));
    assert.equal(
      (await galleryProjects(db, new URLSearchParams(), config.origin)).projects.some(
        (p) => p.id === id,
      ),
      false,
    );
    await mod.mutate(moderator.headers, id, randomUUID(), {
      action: "restore",
      expected_revision: 4,
      reason: "Reviewed",
    });
    assert.equal((await publicProject(db, id)).event_id, null);
  });
  await t.test(
    "linked-event restrictions still apply and missing links do not become no-event",
    async () => {
      const closed = await event(admin, { state: "closed" });
      await association(admin, owner.owner, closed.id);
      await assert.rejects(
        ops.create(owner.headers, randomUUID(), { event_id: closed.id }),
        error("submissions_closed"),
      );
      await assert.rejects(
        ops.create(other.headers, randomUUID(), { event_id: e.id }),
        error("event_link_required"),
      );
      await admin.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [e.id]);
      await assert.rejects(
        ops.save(owner.headers, existing, randomUUID(), {
          expected_version: 2,
          fields,
          review_source: { method: "typed" },
        }),
        error("event_suspended"),
      );
    },
  );
  await t.test("restore preserves no-event bindings, data and readiness", async () => {
    const checks = (await admin.query(sql("m['OPTIONAL_EVENT_CHECK_SQL']"))).rows[0]
      .json_build_object;
    assert.equal(checks.optionalEventIntegrity, true);
    assert.equal(checks.optionalEventPrivileges, true);
    const hashes = (await admin.query(sql("m['record_hashes_sql'](15)"))).rows[0].json_build_object;
    const restored = createDatabase(await restoreOwned(f, "brag_restore_optional"));
    const restoreUrl = new URL(f.adminUrl);
    restoreUrl.pathname = "/brag_restore_optional";
    const restoredAdmin = new pg.Client({ connectionString: restoreUrl.toString() });
    await restoredAdmin.connect();
    try {
      assert.equal(await isDatabaseReady(restored), true);
      assert.deepEqual(
        (await restoredAdmin.query(sql("m['record_hashes_sql'](15)"))).rows[0].json_build_object,
        hashes,
      );
      assert.equal((await publicProject(restored, id)).event_id, null);
    } finally {
      await restoredAdmin.end();
      await restored.$disconnect();
    }
  });
});
