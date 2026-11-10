import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
  ownedFixture,
  bootstrapSchema12,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { identity, event, draft as fixtureDraft } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { publicationHandler } from "../src/lib/publication/handler.ts";
import { publicProject, publicEventProjects } from "../src/lib/publication/reads.ts";
import { galleryProjects } from "../src/lib/gallery/reads.ts";
import { deletionOperations } from "../src/lib/deletion/operations.ts";
import { draftOperations } from "../src/lib/projects/drafts.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";
import { emptyProject } from "../src/projects/model.ts";
import { intentHash } from "../src/lib/sharing/admission.ts";
import { projectionHash } from "../src/lib/publication/hash.ts";

const status = (n: number) => (e: { status?: number }) => e.status === n;
const error = (code: string) => (e: { code?: string }) => e.code === code;
test("schema-12 upgrade and versioned publication lifecycle", async (t) => {
  const f = await ownedFixture();
  await bootstrapSchema12(f);
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
  owner.headers.set("X-Capture-Contract", "share-work-v1");
  const id = await fixtureDraft(admin, owner.owner, e.id, "confirmed"),
    reviewId = randomUUID(),
    pubId = randomUUID();
  const projection = {
    title: "Original",
    problem: "A problem",
    description: "Public content",
    event: "Sharing event",
    language: "en",
    author: {
      name: "Author",
      contact: "https://example.test/author",
      href: "https://example.test/author",
    },
    links: [],
    sections: [],
  };
  const choices = {
    public_author: {
      display_name: "Author",
      contact: { kind: "profile", value: "https://example.test/author" },
    },
    include: { project_link: false, repository_link: false, details: false },
  };
  await admin.query(
    "INSERT INTO brag.project_admission(project_id,owner_id,event_id,origin,source_id,admitted_at) VALUES($1,$2,$3,'typed',$4,now())",
    [id, owner.owner, e.id, randomUUID()],
  );
  await admin.query(
    "INSERT INTO brag.publication_review(id,project_id,owner_id,event_id,draft_version,publication_version,projection,projection_hash,selection,created_at,expires_at) VALUES($1,$2,$3,$4,2,1,$5,$6,$7,now(),now()+interval '15 minutes')",
    [reviewId, id, owner.owner, e.id, projection, projectionHash(projection), choices],
  );
  await admin.query(
    "INSERT INTO brag.project_publication(id,project_id,owner_id,event_id,version,draft_version,review_id,projection,projection_hash) VALUES($1,$2,$3,$4,1,2,$5,$6,$7)",
    [pubId, id, owner.owner, e.id, reviewId, projection, projectionHash(projection)],
  );
  await admin.query(
    "INSERT INTO brag.project_public_state(project_id,owner_id,event_id,publication_id,visibility) VALUES($1,$2,$3,$4,'published')",
    [id, owner.owner, e.id, pubId],
  );
  await admin.query("INSERT INTO brag.event_appearance(project_id,event_id) VALUES($1,$2)", [
    id,
    e.id,
  ]);
  const oldReviewKey = randomUUID();
  await admin.query(
    "INSERT INTO brag.publication_mutation(actor_id,key,project_id,operation,intent_hash,result) VALUES($1,$2,$3,'review',$4,$5)",
    [
      owner.owner,
      oldReviewKey,
      id,
      intentHash(["review", id, { expected_version: 2, ...choices }]),
      { review_id: reviewId },
    ],
  );
  const backupSQL = (expression: string) => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        "import importlib.util; s=importlib.util.spec_from_file_location('b','deploy/runtime/backup-guest.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(" +
          expression +
          ")",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const oldHashes = (await admin.query(backupSQL("m.record_hashes_sql(12)"))).rows[0]
    .json_build_object.recordHashes;
  await t.test("failed lifecycle DDL rolls back to the complete previous schema", async () => {
    const migrator = new pg.Client({ connectionString: f.migrationUrl });
    await migrator.connect();
    try {
      const sql = await readFile(
        "app/prisma/migrations/202611100013_publication_lifecycle/migration.sql",
        "utf8",
      );
      await assert.rejects(
        migrator.query(sql.replace("COMMIT;", "SELECT 1/0; COMMIT;")),
        /division by zero/,
      );
      await migrator.query("ROLLBACK");
      assert.equal(
        (await admin.query("SELECT schema_version FROM brag.runtime_metadata WHERE id=1")).rows[0]
          .schema_version,
        12,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='brag' AND table_name='project_public_state' AND column_name='revision'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await admin.query("SELECT count(*)::int AS n FROM brag.project_publication")).rows[0].n,
        1,
      );
    } finally {
      await migrator.end();
    }
  });
  await t.test("upgrade preserves schema-12 snapshots and publication receipts", async () => {
    const before = (
      await admin.query("SELECT to_jsonb(p)-'event_scope' AS row FROM brag.project_publication p")
    ).rows;
    const result = migrateCandidate(f);
    assert.equal(result.status, 0, result.output);
    assert.equal(migrateCandidate(f).status, 0);
    assert.deepEqual(
      (await admin.query("SELECT to_jsonb(p)-'event_scope' AS row FROM brag.project_publication p"))
        .rows,
      before,
    );
    assert.equal(await isDatabaseReady(db), true);
    assert.deepEqual((await publicProject(db, id)).content, projection);
    const hashes = (await admin.query(backupSQL("m.record_hashes_sql(13)"))).rows[0]
      .json_build_object.recordHashes;
    for (const [name, value] of Object.entries(oldHashes)) assert.equal(hashes[name], value, name);
    assert.match(hashes.publicationReviewFacts, /^[a-f0-9]{64}$/);
    assert.match(hashes.publicationStateFacts, /^[a-f0-9]{64}$/);
  });
  const auth = createAuth(db, config),
    ops = publicationOperations(auth, db, config.origin),
    drafts = draftOperations(auth, db, config.origin, false),
    deletion = deletionOperations(auth, db);
  await t.test("pre-upgrade first-review idempotency key retains its exact meaning", async () => {
    assert.equal(
      (await ops.prepare(owner.headers, id, oldReviewKey, { expected_version: 2, ...choices }))
        .review_id,
      reviewId,
    );
  });
  const currentDraft = async () => db.projectDraft.findUniqueOrThrow({ where: { id } });
  const currentState = async () => {
    const p = (await ops.state(owner.headers, id)).publication;
    assert.ok(p);
    return p;
  };
  const prepare = async () =>
    ops.prepare(owner.headers, id, randomUUID(), {
      ...choices,
      expected_version: (await currentDraft()).version,
      expected_publication_revision: (await currentState()).revision,
    });
  const save = async (title: string) =>
    drafts.save(owner.headers, id, randomUUID(), {
      expected_version: (await currentDraft()).version,
      fields: {
        ...emptyProject,
        title,
        problem: "A problem",
        description: "Updated public content",
        repository_url: "https://example.test/secret",
      },
      review_source: { method: "typed" },
    });
  await t.test(
    "owner-only state and closed-event update preserve public snapshot until reviewed commit",
    async () => {
      for (const h of [new Headers(), new Headers({ Authorization: "Bearer upload-only" })])
        await assert.rejects(ops.state(h, id), status(401));
      await assert.rejects(ops.state(other.headers, id), status(404));
      await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [e.id]);
      await save("Updated");
      assert.deepEqual((await publicProject(db, id)).content, projection);
      const review = await prepare();
      assert.equal(review.publication_version, 2);
      assert.equal(review.publication_revision, 1);
      assert.ok(!JSON.stringify(review.public_project).includes("secret"));
      const key = randomUUID(),
        receipts = await Promise.all([
          ops.publish(owner.headers, id, key, { review_id: review.review_id }),
          ops.publish(owner.headers, id, key, { review_id: review.review_id }),
        ]);
      assert.deepEqual(receipts[0], receipts[1]);
      assert.equal(receipts[0].publication_version, 2);
      assert.equal((await publicProject(db, id)).content.title, "Updated");
      assert.equal((await publicEventProjects(db, e.id)).projects.length, 1);
      assert.equal((await currentDraft()).confirmedVersion, (await currentDraft()).version);
    },
  );
  let oldPublishKey = "",
    withdrawKey = "";
  await t.test(
    "withdrawal invalidates reviews and deletion confirmation; historical replay never republishes",
    async () => {
      const before = await currentDraft(),
        state = await currentState(),
        review = await prepare();
      withdrawKey = randomUUID();
      const body = {
        expected_version: before.version,
        expected_publication_revision: state.revision,
      };
      const results = await Promise.all([
        ops.withdraw(owner.headers, id, withdrawKey, body),
        ops.withdraw(owner.headers, id, withdrawKey, body),
      ]);
      assert.deepEqual(results[0], results[1]);
      assert.deepEqual(
        await ops.withdraw(owner.headers, id, withdrawKey, {
          expected_publication_revision: body.expected_publication_revision,
          expected_version: body.expected_version,
        }),
        results[0],
      );

      assert.deepEqual(await ops.withdrawalReceipt(owner.headers, id, withdrawKey), results[0]);
      await assert.rejects(ops.withdraw(other.headers, id, randomUUID(), body), status(404));
      await assert.rejects(
        ops.withdraw(owner.headers, id, withdrawKey, { ...body, expected_version: 1 }),
        error("idempotency_conflict"),
      );
      await assert.rejects(
        ops.publish(owner.headers, id, randomUUID(), { review_id: review.review_id }),
        error("version_conflict"),
      );
      await assert.rejects(
        deletion.remove(owner.headers, id, randomUUID(), {
          expected_version: before.version,
          expected_published: true,
        }),
        error("version_conflict"),
      );
      await assert.rejects(publicProject(db, id), status(404));
      assert.equal((await publicEventProjects(db, e.id)).projects.length, 0);
      assert.equal(
        (await galleryProjects(db, new URLSearchParams(), config.origin)).projects.length,
        0,
      );
      const next = await prepare();
      oldPublishKey = randomUUID();
      const receipt = await ops.publish(owner.headers, id, oldPublishKey, {
        review_id: next.review_id,
      });
      assert.equal(receipt.publication_version, 3);
      assert.deepEqual(await ops.withdraw(owner.headers, id, withdrawKey, body), results[0]);
      assert.equal((await publicProject(db, id)).publication_version, 3);
      const d = await currentDraft(),
        s = await currentState();
      await ops.withdraw(owner.headers, id, randomUUID(), {
        expected_version: d.version,
        expected_publication_revision: s.revision,
      });
      assert.deepEqual(
        await ops.publish(owner.headers, id, oldPublishKey, { review_id: next.review_id }),
        receipt,
      );
      await assert.rejects(publicProject(db, id), status(404));
    },
  );
  await t.test(
    "stale reviews and moderation restrictions cannot overwrite, suspension still permits withdrawal",
    async () => {
      const review = await prepare();
      await save("Private newer edit");
      await assert.rejects(
        ops.publish(owner.headers, id, randomUUID(), { review_id: review.review_id }),
        error("version_conflict"),
      );
      const next = await prepare();
      await admin.query(
        "UPDATE brag.project_public_state SET visibility='hidden' WHERE project_id=$1",
        [id],
      );
      await assert.rejects(
        ops.publish(owner.headers, id, randomUUID(), { review_id: next.review_id }),
        error("publication_restricted"),
      );
      await assert.rejects(prepare(), error("publication_restricted"));
      await admin.query(
        "UPDATE brag.project_public_state SET owner_withdrawn=false WHERE project_id=$1",
        [id],
      );
      await admin.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [e.id]);
      const d = await currentDraft(),
        s = await currentState();
      await ops.withdraw(owner.headers, id, randomUUID(), {
        expected_version: d.version,
        expected_publication_revision: s.revision,
      });
      assert.equal((await currentState()).visibility, "hidden");
      assert.equal((await currentState()).owner_withdrawn, true);
      await assert.rejects(publicProject(db, id), status(404));
      await admin.query("UPDATE brag.event SET approval='approved' WHERE id=$1", [e.id]);
    },
  );
  await t.test(
    "runtime privilege boundary and direct transition functions reject invalid owner/version",
    async () => {
      await assert.rejects(
        runtime.query("UPDATE brag.project_public_state SET visibility='published'"),
        (e: { code?: string }) => e.code === "42501",
      );
      await assert.rejects(
        runtime.query("SELECT brag.withdraw_publication($1,$2,1,1)", [id, other.owner]),
        /Project unavailable/,
      );
      await assert.rejects(
        runtime.query("SELECT brag.activate_publication($1,$2,$3)", [id, owner.owner, pubId]),
        /state conflict/,
      );
      await admin.query("GRANT UPDATE(revision) ON brag.project_public_state TO brag_runtime");
      assert.equal(await isDatabaseReady(db), false);
      await admin.query("REVOKE UPDATE(revision) ON brag.project_public_state FROM brag_runtime");
      assert.equal(await isDatabaseReady(db), true);
      await admin.query("GRANT INSERT(project_id) ON brag.project_public_state TO brag_runtime");
      assert.equal(await isDatabaseReady(db), false);
      assert.equal(
        (await admin.query(backupSQL("m.LIFECYCLE_CHECK_SQL"))).rows[0].json_build_object
          .lifecyclePrivileges,
        false,
      );
      await admin.query("REVOKE INSERT(project_id) ON brag.project_public_state FROM brag_runtime");
      assert.equal(await isDatabaseReady(db), true);
    },
  );
  await t.test("HTTP owner/origin/malformed boundaries and no-store receipts", async () => {
    const handler = publicationHandler(auth, db, config);
    const call = (
      suffix: string,
      method = "GET",
      body?: unknown,
      origin = config.origin,
      cookie = owner.cookie,
    ) =>
      handler(
        new Request(config.origin + `/api/v1/projects/${id}/` + suffix, {
          method,
          headers: {
            Cookie: cookie,
            Origin: origin,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    assert.equal(
      (await call("publication-state", "GET", undefined, config.origin, other.cookie)).status,
      404,
    );
    assert.equal(
      (
        await call(
          "withdraw",
          "POST",
          { expected_version: 1, expected_publication_revision: 1 },
          "https://evil.test",
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("withdraw", "POST", { expected_version: 1, expected_publication_revision: -1 }))
        .status,
      400,
    );
    const receipt = await call("withdrawal-receipts/" + withdrawKey);
    assert.equal(receipt.status, 200);
    assert.match(receipt.headers.get("cache-control") ?? "", /no-store/);
    await admin.query("DELETE FROM brag.auth_session WHERE id=$1", [other.session]);
    await assert.rejects(ops.state(other.headers, id), status(401));
  });
  await t.test(
    "restore preserves versions, withdrawal, history and schema-13 recovery checks",
    async () => {
      const sql = spawnSync(
        "python3",
        [
          "-c",
          "import importlib.util; s=importlib.util.spec_from_file_location('b','deploy/runtime/backup-guest.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.LIFECYCLE_CHECK_SQL)",
        ],
        { encoding: "utf8" },
      );
      assert.equal(sql.status, 0);
      const checks = (await admin.query(sql.stdout)).rows[0].json_build_object;
      assert.deepEqual(checks, { lifecycleIntegrity: true, lifecyclePrivileges: true });
      await admin.query("BEGIN");
      try {
        await admin.query("UPDATE brag.project_public_state SET revision=1 WHERE project_id=$1", [
          id,
        ]);
        assert.equal(
          (await admin.query(sql.stdout)).rows[0].json_build_object.lifecycleIntegrity,
          false,
        );
      } finally {
        await admin.query("ROLLBACK");
      }
      const hashSql = backupSQL("m.record_hashes_sql(13)");
      const expectedHashes = (await admin.query(hashSql)).rows[0].json_build_object;

      const restored = createDatabase(await restoreOwned(f, "brag_restore_lifecycle"));
      try {
        assert.equal(await isDatabaseReady(restored), true);
        // Backup hashes require the recovery administrator; runtime cannot read role_audit.
        const restoreAdminUrl = new URL(f.adminUrl);
        restoreAdminUrl.pathname = "/brag_restore_lifecycle";
        const restoreAdmin = new pg.Client({ connectionString: restoreAdminUrl.toString() });
        await restoreAdmin.connect();
        try {
          assert.deepEqual(
            (await restoreAdmin.query(hashSql)).rows[0].json_build_object,
            expectedHashes,
          );
        } finally {
          await restoreAdmin.end();
        }

        for (const table of [
          "publication_review",
          "project_publication",
          "project_public_state",
          "publication_mutation",
        ])
          assert.deepEqual(
            await restored.$queryRawUnsafe(
              `SELECT * FROM brag.${table} ORDER BY to_jsonb(${table})::text`,
            ),
            await db.$queryRawUnsafe(
              `SELECT * FROM brag.${table} ORDER BY to_jsonb(${table})::text`,
            ),
          );
      } finally {
        await restored.$disconnect();
      }
    },
  );
  await t.test(
    "delete withdrawn project removes lifecycle history and keeps exact deletion receipt",
    async () => {
      const d = await currentDraft(),
        key = randomUUID(),
        intent = { expected_version: d.version, expected_published: true };
      const receipt = await deletion.remove(owner.headers, id, key, intent);
      assert.deepEqual(await deletion.remove(owner.headers, id, key, intent), receipt);
      await assert.rejects(ops.state(owner.headers, id), status(404));
      await assert.rejects(ops.receipt(owner.headers, id, oldPublishKey), status(404));
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM brag.project_publication WHERE project_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
