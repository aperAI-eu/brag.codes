import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { exportDeletionLedger, replayDeletionLedger } from "../src/lib/deletion/recovery.ts";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  ownedFixture,
  bootstrapSchema13,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { identity, event, draft } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { moderationOperations } from "../src/lib/moderation/operations.ts";
import { moderationHandler } from "../src/lib/moderation/handler.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { deletionOperations } from "../src/lib/deletion/operations.ts";
import { publicProject, publicEventProjects } from "../src/lib/publication/reads.ts";
import { galleryProjects } from "../src/lib/gallery/reads.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";
const status = (n: number) => (e: { status?: number }) => e.status === n;
const choice = {
  public_author: {
    display_name: "Public builder",
    contact: { kind: "profile", value: "https://example.test/author" },
  },
  include: { project_link: false, repository_link: false, details: false },
};
test("platform moderation upgrade, authorization, lifecycle and recovery", async (t) => {
  const f = await ownedFixture();
  await bootstrapSchema13(f);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const db = createDatabase(f.runtimeUrl);
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
  });
  await t.test("failed migration rolls back without changing schema13", async () => {
    const c = new pg.Client({ connectionString: f.migrationUrl });
    await c.connect();
    try {
      const sql = await readFile(
        "app/prisma/migrations/202611100014_moderation/migration.sql",
        "utf8",
      );
      await assert.rejects(
        c.query(sql.replace("COMMIT;", "SELECT 1/0; COMMIT;")),
        /division by zero/,
      );
      await c.query("ROLLBACK");
      assert.equal(
        (await admin.query("SELECT schema_version FROM brag.runtime_metadata")).rows[0]
          .schema_version,
        13,
      );
      assert.equal(
        (await admin.query("SELECT to_regclass('brag.moderation_audit') AS t")).rows[0].t,
        null,
      );
    } finally {
      await c.end();
    }
  });
  assert.equal(migrateCandidate(f).status, 0);
  assert.equal(migrateCandidate(f).status, 0);
  const config = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
  };
  const auth = createAuth(db, config),
    ops = moderationOperations(auth, db),
    pub = publicationOperations(auth, db, config.origin),
    del = deletionOperations(auth, db),
    handler = moderationHandler(auth, db, config);
  const owner = await identity(admin, config.authSecret),
    moderator = await identity(admin, config.authSecret),
    other = await identity(admin, config.authSecret),
    e = await event(admin);
  await admin.query(
    'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES($1,true,1,now()),($2,true,1,now())',
    [moderator.owner, other.owner],
  );
  async function publish(title: string) {
    const id = await draft(admin, owner.owner, e.id, "confirmed");
    await admin.query(
      "UPDATE brag.project_draft SET fields=jsonb_set(jsonb_set(jsonb_set(fields,'{problem}','\"A shared problem\"'),'{title}',to_jsonb($2::text)),'{description}','\"Approved description\"') WHERE id=$1",
      [id, title],
    );
    const review = await pub.prepare(owner.headers, id, randomUUID(), {
      expected_version: 2,
      ...choice,
    });
    await pub.publish(owner.headers, id, randomUUID(), { review_id: review.review_id });
    return id;
  }
  const id = await publish("Moderated project");
  const mutate = (
    target: string,
    action = "hide",
    revision = 1,
    key: string = randomUUID(),
    reason = "Reviewed claim",
  ) => ops.mutate(moderator.headers, target, key, { action, expected_revision: revision, reason });
  await t.test(
    "readiness and least privileges reject runtime table and column writes",
    async () => {
      assert.equal(await isDatabaseReady(db), true);
      const rt = new pg.Client({ connectionString: f.runtimeUrl });
      await rt.connect();
      try {
        for (const table of ["moderation_audit", "moderation_receipt"]) {
          await assert.rejects(rt.query(`DELETE FROM brag.${table}`), { code: "42501" });
          await assert.rejects(rt.query(`INSERT INTO brag.${table} DEFAULT VALUES`), {
            code: "42501",
          });
        }
        await assert.rejects(
          rt.query("SELECT brag.moderate_project($1,$2,$3,'hide',1,'Denied')", [
            id,
            owner.owner,
            randomUUID(),
          ]),
          { code: "42501" },
        );
        await admin.query("GRANT UPDATE(reason) ON brag.moderation_audit TO brag_runtime");
        assert.equal(await isDatabaseReady(db), false);
        await admin.query("REVOKE UPDATE(reason) ON brag.moderation_audit FROM brag_runtime");
        assert.equal(await isDatabaseReady(db), true);
      } finally {
        await rt.end();
      }
    },
  );
  await t.test(
    "direct operations enforce active admin and never return unpublished draft data",
    async () => {
      for (const call of [() => ops.list(new Headers(), {}), () => ops.detail(new Headers(), id)])
        await assert.rejects(call(), status(401));
      await assert.rejects(ops.list(owner.headers, {}), status(403));
      await assert.rejects(
        ops.mutate(owner.headers, id, randomUUID(), {
          action: "hide",
          expected_revision: 1,
          reason: "Owner cannot moderate",
        }),
        status(403),
      );
      const privateId = await draft(admin, owner.owner, e.id, "confirmed");
      await assert.rejects(ops.detail(moderator.headers, privateId), status(404));
      await admin.query(
        "UPDATE brag.project_draft SET fields=jsonb_set(fields,'{description}','\"unpublished-secret\"') WHERE id=$1",
        [id],
      );
      const result = await ops.list(moderator.headers, {});
      assert.equal(result.projects.length, 1);
      assert.ok(!JSON.stringify(result).includes("unpublished-secret"));
    },
  );
  await t.test("bounded filters/cursors escape search and reject cross-filter reuse", async () => {
    await publish("100% useful");
    await publish("Another project");
    const first = await ops.list(moderator.headers, { limit: 1 });
    assert.ok(first.next_cursor);
    const second = await ops.list(moderator.headers, { limit: 1, cursor: first.next_cursor });
    assert.notEqual(first.projects[0].id, second.projects[0].id);
    await assert.rejects(
      ops.list(moderator.headers, { query: "different", cursor: first.next_cursor }),
      status(400),
    );
    assert.equal((await ops.list(moderator.headers, { query: "%" })).projects.length, 1);
    assert.equal((await ops.list(moderator.headers, { query: "' OR true --" })).projects.length, 0);
    assert.equal((await ops.events(moderator.headers, {})).events[0].id, e.id);
    for (const v of [
      { limit: 51 },
      { query: "x".repeat(201) },
      { event_id: "bad" },
      { visibility: "private" },
      { unknown: true },
      { cursor: "!" },
    ])
      await assert.rejects(ops.list(moderator.headers, v), status(400));
  });
  let hideKey: string;
  await t.test(
    "hide is atomic, blocks all public projections and invalidates pending publication review",
    async () => {
      const review = await pub.prepare(owner.headers, id, randomUUID(), {
        expected_version: 2,
        expected_publication_revision: 1,
        ...choice,
      });
      hideKey = randomUUID();
      const receipt = await mutate(id, "hide", 1, hideKey, "  Review <script>claim</script>  ");
      assert.equal(receipt.hidden, true);
      const view = await ops.detail(moderator.headers, id);
      assert.equal(view.revision, 2);
      assert.equal(view.history.length, 1);
      assert.equal(view.history[0].reason, "Review <script>claim</script>");
      await assert.rejects(publicProject(db, id), status(404));
      assert.ok(
        !(await galleryProjects(db, new URLSearchParams(), f.baseUrl)).projects.some(
          (p) => p.id === id,
        ),
      );
      assert.ok(
        !JSON.stringify(await publicEventProjects(db, e.id, new URLSearchParams())).includes(id),
      );
      await assert.rejects(
        pub.publish(owner.headers, id, randomUUID(), { review_id: review.review_id }),
        status(409),
      );
      await assert.rejects(
        del.remove(owner.headers, id, randomUUID(), {
          expected_version: 2,
          expected_published: true,
        }),
        status(409),
      );
    },
  );
  await t.test(
    "exact retry returns one historical receipt; cross-admin receipt and altered intent fail",
    async () => {
      const receipt = await mutate(id, "hide", 1, hideKey, "Review <script>claim</script>");
      assert.equal(receipt.revision, 2);
      assert.equal((await ops.detail(moderator.headers, id)).history.length, 1);
      await assert.rejects(mutate(id, "hide", 1, hideKey, "changed"), status(409));
      await assert.rejects(ops.receipt(other.headers, hideKey), status(404));
      assert.deepEqual(await ops.receipt(moderator.headers, hideKey), receipt);
    },
  );
  await t.test(
    "withdrawal remains independent of hide and restore; replay never hides again",
    async () => {
      const state = await ops.detail(moderator.headers, id);
      const d = (await admin.query("SELECT version FROM brag.project_draft WHERE id=$1", [id]))
        .rows[0];
      await pub.withdraw(owner.headers, id, randomUUID(), {
        expected_version: d.version,
        expected_publication_revision: state.revision,
      });
      await assert.rejects(mutate(id, "restore", 2), status(409));
      const r = await mutate(id, "restore", 3);
      assert.equal(r.owner_withdrawn, true);
      assert.equal(r.hidden, false);
      await assert.rejects(publicProject(db, id), status(404));
      await mutate(id, "hide", 1, hideKey, "Review <script>claim</script>");
      assert.equal((await ops.detail(moderator.headers, id)).hidden, false);
    },
  );
  await t.test(
    "two moderators using the same revision produce one winner and one conflict",
    async () => {
      const target = await publish("Concurrent review"),
        data = { action: "hide", expected_revision: 1, reason: "Concurrent reason" };
      const results = await Promise.allSettled([
        ops.mutate(moderator.headers, target, randomUUID(), data),
        ops.mutate(other.headers, target, randomUUID(), data),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await ops.detail(moderator.headers, target)).history.length, 1);
      await mutate(target, "restore", 2);
      assert.equal((await publicProject(db, target)).content.title, "Concurrent review");
    },
  );
  await t.test(
    "transport rejects cross-origin, oversized, unknown and duplicated input with private errors",
    async () => {
      const path = config.origin + `/api/v1/projects/${id}/moderation`;
      const request = (body: unknown, origin = config.origin) =>
        handler(
          new Request(path, {
            method: "POST",
            headers: {
              Cookie: moderator.cookie,
              Origin: origin,
              "Content-Type": "application/json",
              "Idempotency-Key": randomUUID(),
            },
            body: JSON.stringify(body),
          }),
        );
      assert.equal(
        (
          await request(
            { action: "hide", expected_revision: 4, reason: "No" },
            "https://foreign.test",
          )
        ).status,
        403,
      );
      for (const body of [
        { action: "delete", expected_revision: 4, reason: "No" },
        { action: "hide", expected_revision: 4, reason: " " },
        { action: "hide", expected_revision: 4, reason: "x".repeat(1001) },
        { action: "hide", expected_revision: 4, reason: "Valid", extra: true },
      ])
        assert.equal((await request(body)).status, 400);
      const r = await handler(
        new Request(config.origin + "/api/v1/admin/moderation/projects?limit=1&limit=2", {
          headers: moderator.headers,
        }),
      );
      assert.equal(r.status, 400);
      assert.match(r.headers.get("cache-control")!, /no-store/);
    },
  );
  await t.test(
    "revoked role blocks replay and direct SQL; deleted publication cascades moderation records",
    async () => {
      await admin.query('UPDATE brag.platform_role SET active=false WHERE "userId"=$1', [
        moderator.owner,
      ]);
      await assert.rejects(ops.receipt(moderator.headers, hideKey), status(403));
      await admin.query('UPDATE brag.platform_role SET active=true WHERE "userId"=$1', [
        moderator.owner,
      ]);
      const version = (
        await admin.query("SELECT version FROM brag.project_draft WHERE id=$1", [id])
      ).rows[0].version;
      await del.remove(owner.headers, id, randomUUID(), {
        expected_version: version,
        expected_published: true,
      });
      for (const table of ["moderation_audit", "moderation_receipt"])
        assert.equal(
          (await admin.query(`SELECT count(*)::int n FROM brag.${table} WHERE project_id=$1`, [id]))
            .rows[0].n,
          0,
        );
      await assert.rejects(mutate(id, "restore", 4), status(404));
      await assert.rejects(ops.receipt(moderator.headers, hideKey), status(404));
    },
  );
  await t.test(
    "authority revocation while waiting prevents commit; withdrawal races stay hidden or withdrawn",
    async () => {
      const queued = await identity(admin, config.authSecret);
      await admin.query(
        'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES($1,true,1,now())',
        [queued.owner],
      );
      const target = await publish("Racing withdrawal");
      await admin.query("BEGIN");
      await admin.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1789))", [queued.owner]);
      const attempt = ops.mutate(queued.headers, target, randomUUID(), {
        action: "hide",
        expected_revision: 1,
        reason: "Queued moderation",
      });
      const denied = assert.rejects(attempt, status(403));
      await admin.query('UPDATE brag.platform_role SET active=false WHERE "userId"=$1', [
        queued.owner,
      ]);
      await admin.query("COMMIT");
      await denied;
      assert.equal((await ops.detail(moderator.headers, target)).revision, 1);
      const results = await Promise.allSettled([
        mutate(target),
        pub.withdraw(owner.headers, target, randomUUID(), {
          expected_version: 2,
          expected_publication_revision: 1,
        }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      await assert.rejects(publicProject(db, target), status(404));
      const state = await ops.detail(moderator.headers, target);
      assert.ok(state.hidden || state.withdrawn);
    },
  );
  await t.test(
    "recovery hashes and moderation integrity validate an older restore before deletion replay",
    async () => {
      const target = await publish("Deleted after backup");
      await mutate(target);
      const backupSQL = (expr: string) => {
        const r = spawnSync(
          "python3",
          [
            "-c",
            "import importlib.util; s=importlib.util.spec_from_file_location('b','deploy/runtime/backup-guest.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(" +
              expr +
              ")",
          ],
          { encoding: "utf8" },
        );
        assert.equal(r.status, 0, r.stderr);
        return r.stdout;
      };
      const checks = backupSQL("m.MODERATION_CHECK_SQL"),
        hashes = backupSQL("m.record_hashes_sql(14)");
      assert.deepEqual((await admin.query(checks)).rows[0].json_build_object, {
        moderationIntegrity: true,
        moderationPrivileges: true,
      });
      const fingerprintSql = await readFile("deploy/runtime/recovery-query.sql", "utf8");
      assert.equal(
        backupSQL("m.SCHEMA_FINGERPRINT_SQL").trim(),
        ("SET ROLE brag_migrator; " + fingerprintSql).trim(),
      );
      const fingerprint = async (client: pg.Client) => {
        await client.query("SET ROLE brag_migrator");
        try {
          return (await client.query(fingerprintSql)).rows[0].fingerprint;
        } finally {
          await client.query("RESET ROLE");
        }
      };
      const beforeFingerprint = await fingerprint(admin);
      const before = (await admin.query(hashes)).rows[0].json_build_object;
      const restoredUrl = await restoreOwned(f, "brag_restore_moderationledger");
      const url = new URL(restoredUrl);
      url.username = new URL(f.adminUrl).username;
      url.password = new URL(f.adminUrl).password;
      const restore = new pg.Client({ connectionString: url.toString() });
      await restore.connect();
      try {
        assert.deepEqual((await restore.query(hashes)).rows[0].json_build_object, before);
        assert.equal(
          await fingerprint(restore),
          beforeFingerprint,
          "dump/restore must preserve the schema fingerprint despite AND regrouping",
        );
        for (const mutation of [
          "ALTER TABLE brag.moderation_audit DROP CONSTRAINT moderation_audit_reason_check; ALTER TABLE brag.moderation_audit ADD CONSTRAINT moderation_audit_reason_check CHECK(length(reason) BETWEEN 1 AND 999 AND reason=btrim(reason) AND reason ~ '[^[:space:]]')",
          "ALTER TABLE brag.moderation_audit DROP CONSTRAINT moderation_audit_reason_check; ALTER TABLE brag.moderation_audit ADD CONSTRAINT moderation_audit_reason_check CHECK(length(reason) BETWEEN 1 AND 1000 OR reason=btrim(reason) AND reason ~ '[^[:space:]]')",
          "GRANT UPDATE(reason) ON brag.moderation_audit TO brag_runtime",
        ]) {
          await restore.query("BEGIN");
          try {
            await restore.query(mutation);
            assert.notEqual(
              await fingerprint(restore),
              beforeFingerprint,
              "real constraint or privilege changes must remain detectable",
            );
          } finally {
            await restore.query("ROLLBACK");
          }
        }

        await del.remove(owner.headers, target, randomUUID(), {
          expected_version: 3,
          expected_published: true,
        });
        const ledger = await exportDeletionLedger(admin, "local");
        await replayDeletionLedger(restore, ledger, "local");
        await replayDeletionLedger(restore, ledger, "local");
        for (const table of ["moderation_audit", "moderation_receipt"])
          assert.equal(
            (
              await restore.query(`SELECT count(*)::int n FROM brag.${table} WHERE project_id=$1`, [
                target,
              ])
            ).rows[0].n,
            0,
          );
        assert.deepEqual((await restore.query(checks)).rows[0].json_build_object, {
          moderationIntegrity: true,
          moderationPrivileges: true,
        });
      } finally {
        await restore.end();
      }
    },
  );
  await t.test("restore retains audit, receipts, hidden state and narrow grants", async () => {
    const target = await publish("Restore fixture");
    await mutate(target);
    const restored = createDatabase(await restoreOwned(f, "brag_restore_moderation"));
    try {
      assert.equal(await isDatabaseReady(restored), true);
      await assert.rejects(publicProject(restored, target), status(404));
      const restoredOps = moderationOperations(createAuth(restored, config), restored);
      assert.equal((await restoredOps.detail(moderator.headers, target)).history.length, 1);
    } finally {
      await restored.$disconnect();
    }
  });
});
