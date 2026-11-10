import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import path from "node:path";
import {
  ownedFixture,
  bootstrapSchema7,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { identity, event, association, draft, agent, pitch } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { publicationHandler } from "../src/lib/publication/handler.ts";
import { publicProject, publicEventProjects } from "../src/lib/publication/reads.ts";
import { draftOperations } from "../src/lib/projects/drafts.ts";
import { emptyProject } from "../src/projects/model.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";

const status = (code: number) => (e: { status?: number }) => e.status === code;
const error = (code: string) => (e: { code?: string }) => e.code === code;
const content = {
  ...emptyProject,
  title: "Poznámky bez internetu",
  problem: "Potrebujem pracovať offline.",
  description: "Súkromný projekt v slovenčine.",
  language: "sk",
  repository_url: "https://example.test/private",
  details: { ...emptyProject.details, gotchas: "not a field", core_idea: "unselected-details" },
};
delete (content.details as { gotchas?: string }).gotchas;
const choices = (version: number) => ({
  expected_version: version,
  public_author: {
    display_name: "Demo author",
    contact: { kind: "profile", value: "https://example.test/author" },
  },
  include: { project_link: false, repository_link: false, details: false },
});
test("publication migration, authorization, immutable projection and recovery on an owned database", async (t) => {
  const f = await ownedFixture();
  const admin = new pg.Client({ connectionString: f.adminUrl }),
    runtime = new pg.Client({ connectionString: f.runtimeUrl });
  await Promise.all([admin.connect(), runtime.connect()]);
  const db = createDatabase(f.runtimeUrl);
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
    await runtime.end();
  });
  await bootstrapSchema7(f);
  const config = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
  };
  const owner = await identity(admin, config.authSecret),
    other = await identity(admin, config.authSecret),
    e = await event(admin);
  const typed = await draft(admin, owner.owner, e.id, "confirmed"),
    reserved = await draft(admin, owner.owner, e.id, "reserved"),
    legacy = await draft(admin, owner.owner, e.id, "legacy");
  const accepted = await draft(admin, owner.owner, e.id, "confirmed");
  await agent(admin, owner.owner, e.id, accepted, { base: 1, accepted: true, cleared: true });
  const voiced = await draft(admin, owner.owner, e.id, "confirmed");
  const voiceId = await pitch(admin, owner.owner, voiced, "ready", { base: 1 });
  await admin.query("UPDATE brag.project_draft SET last_edit=$2 WHERE id=$1", [
    voiced,
    { method: "voice", approved_pitch: { id: voiceId, attempt: 2 } },
  ]);
  for (const [id, version] of [
    [typed, 2],
    [reserved, 1],
  ] as const)
    await admin.query(
      "INSERT INTO brag.draft_mutation(actor_id,key,intent_hash,result) VALUES ($1,$2,$3,$4)",
      [
        owner.owner,
        randomUUID(),
        "a".repeat(64),
        {
          draft_id: id,
          receipt: {
            operation_class: "new_submission",
            draft_id: id,
            version,
            committed_at: new Date().toISOString(),
          },
        },
      ],
    );
  const tables = [
    "project_draft",
    "voice_pitch",
    "agent_proposal",
    "draft_mutation",
    "author_event",
  ];
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (
            await admin.query(
              "SELECT (to_jsonb(t) - ARRAY['event_scope','deleted_at','audio_removed_at','recovery_config_version','transcription_attempt','transcription_started_at']) AS row FROM brag." +
                table +
                " t ORDER BY row_to_json(t)::text",
            )
          ).rows,
        ]),
      ),
    );
  const before = await snapshot();
  await t.test(
    "failed schema-8 DDL rolls back completely and only verified recovery can resolve it",
    async () => {
      const migrator = new pg.Client({ connectionString: f.migrationUrl });
      await migrator.connect();
      try {
        const schemaFingerprint = (
          await migrator.query(await readFile("deploy/runtime/recovery-query.sql", "utf8"))
        ).rows[0].fingerprint;
        const hashes = JSON.parse(
          (
            await migrator.query(
              await readFile("deploy/runtime/recovery-publication-hashes.sql", "utf8"),
            )
          ).rows[0].recovery_hashes,
        );
        const checkpoint = path.join(path.dirname(f.migrationFile), "publication-checkpoint.json");
        const receipt = {
          preMigrationBackup: { restore: "passed", schemaVersion: 7, schemaFingerprint, ...hashes },
        };
        await writeFile(checkpoint, JSON.stringify(receipt));
        await admin.query(
          "CREATE FUNCTION public.fail_publication_fixture() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='brag.publication_review') THEN RAISE EXCEPTION 'Synthetic publication migration failure'; END IF; END $$; CREATE EVENT TRIGGER fail_publication_fixture ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.fail_publication_fixture();",
        );
        try {
          assert.notEqual(migrateCandidate(f).status, 0);
        } finally {
          await admin.query(
            "DROP EVENT TRIGGER fail_publication_fixture; DROP FUNCTION public.fail_publication_fixture()",
          );
        }
        assert.equal(
          (await admin.query("SELECT to_regclass('brag.project_admission') AS relation")).rows[0]
            .relation,
          null,
        );
        assert.deepEqual(await snapshot(), before);
        const recover = () =>
          spawnSync(
            process.execPath,
            ["--import", "tsx", "app/scripts/recover-publication.ts", checkpoint],
            {
              env: { ...process.env, MIGRATION_DATABASE_URL_FILE: f.migrationFile },
              encoding: "utf8",
            },
          );
        await writeFile(
          checkpoint,
          JSON.stringify({
            preMigrationBackup: { ...receipt.preMigrationBackup, schemaFingerprint: "forged" },
          }),
        );
        assert.notEqual(recover().status, 0);
        await writeFile(checkpoint, JSON.stringify(receipt));
        const recovered = recover();
        assert.equal(recovered.status, 0, recovered.stderr);
        assert.notEqual(recover().status, 0);
      } finally {
        await migrator.end();
      }
    },
  );

  await t.test(
    "schema 7 backfill admits real receipts and approved results, never reservations or arbitrary legacy flags",
    async () => {
      const result = migrateCandidate(f);
      assert.equal(result.status, 0, result.output);
      assert.equal(migrateCandidate(f).status, 0);
      assert.deepEqual(await snapshot(), before);
      const rows = (await admin.query("SELECT project_id,origin FROM brag.project_admission")).rows;
      assert.deepEqual(new Set(rows.map((r) => r.project_id)), new Set([typed, accepted, voiced]));
      assert.equal(await isDatabaseReady(db), true);
    },
  );
  await t.test(
    "runtime cannot forge historical proofs, rewrite snapshots or delete reviews",
    async () => {
      for (const table of [
        "project_admission",
        "publication_review",
        "project_publication",
        "project_public_state",
        "event_appearance",
        "publication_mutation",
      ]) {
        await assert.rejects(
          runtime.query("DELETE FROM brag." + table),
          (e: { code?: string }) => e.code === "42501",
        );
        await assert.rejects(
          runtime.query("TRUNCATE brag." + table),
          (e: { code?: string }) => e.code === "42501",
        );
      }
      await admin.query("GRANT INSERT(source_id) ON brag.project_admission TO brag_runtime");
      assert.equal(await isDatabaseReady(db), false);
      await admin.query("REVOKE INSERT(source_id) ON brag.project_admission FROM brag_runtime");
      assert.equal(await isDatabaseReady(db), true);
      await assert.rejects(
        runtime.query("INSERT INTO brag.project_admission(project_id) VALUES ($1)", [reserved]),
        (e: { code?: string }) => e.code === "42501",
      );
      await assert.rejects(
        runtime.query("SELECT brag.admit_project($1,$2,'typed',$3)", [
          reserved,
          owner.owner,
          randomUUID(),
        ]),
        /save receipt/,
      );
      await assert.rejects(
        runtime.query("SELECT brag.admit_project($1,$2,'historical_voice',$3)", [
          reserved,
          owner.owner,
          voiceId,
        ]),
        /Invalid admission/,
      );
    },
  );
  const auth = createAuth(db, config),
    ops = publicationOperations(auth, db, config.origin),
    drafts = draftOperations(auth, db, config.origin, false);
  owner.headers.set("X-Capture-Contract", "share-work-v1");
  other.headers.set("X-Capture-Contract", "share-work-v1");
  const create = async () => {
    await association(admin, owner.owner, e.id);
    const { draft: d } = await drafts.create(owner.headers, randomUUID(), { event_id: e.id });
    return (
      await drafts.save(owner.headers, d.id, randomUUID(), {
        expected_version: d.version,
        fields: content,
        review_source: { method: "typed" },
      })
    ).draft;
  };
  let project = await create();
  await t.test(
    "ordinary saves create durable live admission; preparation requires owner, complete confirmed version and explicit contact",
    async () => {
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM brag.project_admission WHERE project_id=$1",
            [project.id],
          )
        ).rows[0].n,
        1,
      );
      for (const h of [new Headers(), new Headers({ Authorization: "Bearer agent-token" })])
        await assert.rejects(
          ops.prepare(h, project.id, randomUUID(), choices(project.version)),
          status(401),
        );
      await assert.rejects(
        ops.prepare(other.headers, project.id, randomUUID(), choices(project.version)),
        status(404),
      );
      await assert.rejects(
        ops.prepare(owner.headers, project.id, randomUUID(), {
          ...choices(project.version),
          owner_id: other.owner,
        }),
        status(400),
      );
      for (const value of [
        "javascript:alert(1)",
        "https://u:p@example.test",
        "https://example.test\n",
      ])
        await assert.rejects(
          ops.prepare(owner.headers, project.id, randomUUID(), {
            ...choices(project.version),
            public_author: { display_name: "Me", contact: { kind: "profile", value } },
          }),
          status(422),
        );
      await assert.rejects(
        ops.prepare(owner.headers, project.id, randomUUID(), choices(99)),
        error("version_conflict"),
      );
      await assert.rejects(
        ops.prepare(owner.headers, reserved, randomUUID(), choices(2)),
        error("project_not_confirmed"),
      );
    },
  );
  let review = await ops.prepare(owner.headers, project.id, randomUUID(), choices(project.version));
  await t.test(
    "review is private; publication remains allowed after closing and returns exact immutable projection",
    async () => {
      await assert.rejects(publicProject(db, project.id), status(404));
      assert.equal((await publicEventProjects(db, e.id)).projects.length, 0);
      const bytes = JSON.stringify(review.public_project);
      for (const secret of ["private", "unselected-details", owner.owner, owner.cookie])
        assert.ok(!bytes.includes(secret));
      assert.equal(review.public_project.language, "sk");
      assert.equal(review.public_project.description, content.description);
      await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [e.id]);
      const key = randomUUID(),
        receipt = await ops.publish(owner.headers, project.id, key, {
          review_id: review.review_id,
        });
      assert.equal(receipt.publication_version, 1);
      assert.deepEqual((await publicProject(db, project.id)).content, review.public_project);
      assert.deepEqual(await ops.receipt(owner.headers, project.id, key), receipt);
      assert.deepEqual(
        await ops.publish(owner.headers, project.id, key, { review_id: review.review_id }),
        receipt,
      );
      await assert.rejects(
        ops.publish(owner.headers, project.id, key, { review_id: randomUUID() }),
        error("idempotency_conflict"),
      );
      await assert.rejects(
        ops.publish(owner.headers, project.id, randomUUID(), { review_id: review.review_id }),
        error("review_consumed"),
      );
      await assert.rejects(ops.receipt(other.headers, project.id, key), status(404));
      project = (
        await drafts.save(owner.headers, project.id, randomUUID(), {
          expected_version: project.version,
          fields: { ...content, title: "Edited privately" },
          review_source: { method: "typed" },
        })
      ).draft;
      assert.equal((await publicProject(db, project.id)).content.title, content.title);
      assert.equal((await publicEventProjects(db, e.id)).projects.length, 1);
      await assert.rejects(
        ops.prepare(owner.headers, legacy, randomUUID(), choices(2)),
        error("project_not_confirmed"),
      );
      await admin.query(
        "UPDATE brag.project_draft SET confirmed_version=version,confirmed_at=now() WHERE id=$1",
        [legacy],
      );
      await admin.query("UPDATE brag.project_draft SET fields=$2 WHERE id=$1", [legacy, content]);
      await assert.rejects(
        ops.prepare(owner.headers, legacy, randomUUID(), choices(2)),
        error("admission_unverified"),
      );
    },
  );
  await admin.query("UPDATE brag.event SET manually_closed=false WHERE id=$1", [e.id]);
  await t.test(
    "stale, expired and suspended reviews fail without partial public state; duplicate concurrent publish commits once",
    async () => {
      const d = await create(),
        r = await ops.prepare(owner.headers, d.id, randomUUID(), choices(d.version));
      await drafts.save(owner.headers, d.id, randomUUID(), {
        expected_version: d.version,
        fields: { ...content, title: "Updated" },
        review_source: { method: "typed" },
      });
      await assert.rejects(
        ops.publish(owner.headers, d.id, randomUUID(), { review_id: r.review_id }),
        error("version_conflict"),
      );
      const r2 = await ops.prepare(owner.headers, d.id, randomUUID(), choices(d.version + 1));
      await admin.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [e.id]);
      await assert.rejects(
        ops.publish(owner.headers, d.id, randomUUID(), { review_id: r2.review_id }),
        error("event_suspended"),
      );
      assert.equal((await publicEventProjects(db, e.id)).projects.length, 1);
      await admin.query("UPDATE brag.event SET approval='approved' WHERE id=$1", [e.id]);
      await admin.query(
        "UPDATE brag.publication_review SET created_at=created_at-interval '1 hour',expires_at=expires_at-interval '1 hour' WHERE id=$1",
        [r2.review_id],
      );
      await assert.rejects(
        ops.publish(owner.headers, d.id, randomUUID(), { review_id: r2.review_id }),
        error("review_expired"),
      );
      await assert.rejects(publicProject(db, d.id), status(404));
      const r3 = await ops.prepare(owner.headers, d.id, randomUUID(), choices(d.version + 1)),
        key = randomUUID();
      const receipts = await Promise.all([
        ops.publish(owner.headers, d.id, key, { review_id: r3.review_id }),
        ops.publish(owner.headers, d.id, key, { review_id: r3.review_id }),
      ]);
      assert.deepEqual(receipts[0], receipts[1]);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM brag.project_publication WHERE project_id=$1",
            [d.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "a failed appearance write rolls back every public row and retry keeps the original intent",
    async () => {
      const d = await create(),
        r = await ops.prepare(owner.headers, d.id, randomUUID(), choices(d.version)),
        key = randomUUID();
      await admin.query(
        "CREATE FUNCTION brag.fixture_publication_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic appearance failure'; END $$; CREATE TRIGGER fixture_publication_fail BEFORE INSERT ON brag.event_appearance FOR EACH ROW EXECUTE FUNCTION brag.fixture_publication_fail();",
      );
      try {
        await assert.rejects(ops.publish(owner.headers, d.id, key, { review_id: r.review_id }));
      } finally {
        await admin.query(
          "DROP TRIGGER fixture_publication_fail ON brag.event_appearance; DROP FUNCTION brag.fixture_publication_fail()",
        );
      }
      await assert.rejects(publicProject(db, d.id), status(404));
      await assert.rejects(ops.receipt(owner.headers, d.id, key), status(404));
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM brag.project_publication WHERE project_id=$1",
            [d.id],
          )
        ).rows[0].n,
        0,
      );
      await ops.publish(owner.headers, d.id, key, { review_id: r.review_id });
      // Exclude only this synthetic project from the following two-record cursor fixture.
      await admin.query(
        "UPDATE brag.project_public_state SET visibility='withdrawn' WHERE project_id=$1",
        [d.id],
      );
    },
  );
  await t.test(
    "public keyset pages hide private records and recheck visibility; malformed/cross-event cursors fail",
    async () => {
      const page = await publicEventProjects(db, e.id, new URLSearchParams("limit=1"));
      assert.ok(page.next_cursor);
      const next = await publicEventProjects(
        db,
        e.id,
        new URLSearchParams({ limit: "1", cursor: page.next_cursor }),
      );
      assert.equal(next.projects.length, 1);
      assert.notEqual(next.projects[0].id, page.projects[0].id);
      for (const params of ["limit=51", "limit=1&limit=2", "cursor=bad", "owner_id=x"])
        await assert.rejects(
          publicEventProjects(db, e.id, new URLSearchParams(params)),
          status(400),
        );
      await assert.rejects(
        publicEventProjects(db, randomUUID(), new URLSearchParams({ cursor: page.next_cursor })),
        status(400),
      );
      await admin.query(
        "UPDATE brag.project_public_state SET visibility='hidden' WHERE project_id=$1",
        [next.projects[0].id],
      );
      assert.equal(
        (
          await publicEventProjects(
            db,
            e.id,
            new URLSearchParams({ limit: "1", cursor: page.next_cursor }),
          )
        ).projects.length,
        0,
      );
      await assert.rejects(publicProject(db, next.projects[0].id), status(404));
      await admin.query(
        "UPDATE brag.project_public_state SET visibility='published' WHERE project_id=$1",
        [next.projects[0].id],
      );
    },
  );
  await t.test("HTTP session/CSRF/body boundaries and no-store public projections", async () => {
    const handler = publicationHandler(auth, db, config),
      d = await create();
    const call = (
      path: string,
      method = "GET",
      body?: unknown,
      origin = config.origin,
      cookie = owner.cookie,
    ) =>
      handler(
        new Request(config.origin + path, {
          method,
          headers: {
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    assert.equal(
      (
        await call(
          "/api/v1/projects/" + d.id + "/publication-review",
          "POST",
          choices(d.version),
          "https://evil.test",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/v1/projects/" + d.id + "/publication-review",
          "POST",
          choices(d.version),
          config.origin,
          "",
        )
      ).status,
      401,
    );
    const response = await call("/api/v1/projects/" + project.id);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await call("/api/v1/projects/" + d.id)).status, 404);
    assert.equal(
      (await call("/api/v1/projects/" + d.id + "/publication-review", "POST", choices(d.version)))
        .status,
      201,
    );
  });
  await t.test(
    "dump/restore retains admission, exact public and private snapshots, receipts and restricted grants",
    async () => {
      const url = await restoreOwned(f, "brag_restore_publication"),
        restored = createDatabase(url);
      try {
        assert.equal(await isDatabaseReady(restored), true);
        assert.deepEqual(
          await publicEventProjects(restored, e.id),
          await publicEventProjects(db, e.id),
        );
        for (const table of [
          "project_admission",
          "publication_review",
          "project_publication",
          "project_public_state",
          "event_appearance",
          "publication_mutation",
        ]) {
          const before = await db.$queryRawUnsafe(
            "SELECT (to_jsonb(t) - ARRAY['event_scope','deleted_at','audio_removed_at','recovery_config_version','transcription_attempt','transcription_started_at']) AS row FROM brag." +
              table +
              " t ORDER BY row_to_json(t)::text",
          );
          assert.deepEqual(
            await restored.$queryRawUnsafe(
              "SELECT (to_jsonb(t) - ARRAY['event_scope','deleted_at','audio_removed_at','recovery_config_version','transcription_attempt','transcription_started_at']) AS row FROM brag." +
                table +
                " t ORDER BY row_to_json(t)::text",
            ),
            before,
          );
        }
      } finally {
        await restored.$disconnect();
      }
    },
  );
});
