import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { credentialVault } from "../src/lib/config/vault.ts";
import { configSecrets } from "../src/lib/integrations/settings.ts";
import { randomUUID } from "node:crypto";
import { emptyProject } from "../src/projects/model.ts";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createDatabase } from "../src/lib/database/client.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";
import { identityChecks } from "./identity.integration.ts";
import { seedSharingRows } from "./fixtures/sharing-storage.ts";

// Only the owned-container runner supplies these paths; never consume a developer
// DATABASE_URL or any deployment credential for these mutating integration cases.
const fixture = JSON.parse(await readFile(process.env.BRAG_TEST_FIXTURE_FILE!, "utf8")) as {
  container: string;
  runtimeUrl: string;
  migrationUrl: string;
  adminUrl: string;
  migrationFile: string;
  baseUrl: string;
  operatorUrl: string;
  authFile: string;
  webContainer?: string;
  network?: string;
  migrationImage?: string;
  migrationDockerFile?: string;
};
assert.match(fixture.container, /^brag-runtime-check-[a-z0-9-]+$/);
assert.equal(new URL(fixture.adminUrl).hostname, "127.0.0.1");
const admin = new pg.Client({ connectionString: fixture.adminUrl });
const runtime = new pg.Client({ connectionString: fixture.runtimeUrl });
const db = createDatabase(fixture.runtimeUrl);
// The last case deliberately stops this owned container while clients are idle.
admin.on("error", () => {});
runtime.on("error", () => {});

function migrate(file = fixture.migrationFile) {
  if (fixture.migrationImage && file === fixture.migrationFile) {
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        `${fixture.container}-migration`,
        "--network",
        fixture.network!,
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--tmpfs",
        "/tmp:size=32m,mode=1777",
        "--mount",
        `type=bind,source=${fixture.migrationDockerFile},target=/run/secrets/migration_url,readonly`,
        "-e",
        "MIGRATION_DATABASE_URL_FILE=/run/secrets/migration_url",
        fixture.migrationImage,
      ],
      { encoding: "utf8" },
    );
    return { status: result.status, output: result.stdout + result.stderr };
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", "app/scripts/migrate.ts"], {
    env: { ...process.env, MIGRATION_DATABASE_URL_FILE: file },
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
}
async function status(path: string, expected: number) {
  const response = await fetch(`${fixture.baseUrl}${path}`, {
    signal: AbortSignal.timeout(6000),
    headers: { Connection: "close" },
  });
  assert.equal(response.status, expected);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await response.json(), { status: expected === 200 ? "ok" : "unavailable" });
}

test("runtime migration, privileges, health, recovery and restore on an isolated PostgreSQL instance", async (t) => {
  await admin.connect();
  await runtime.connect();
  try {
    await t.test("server renders the real shell and ships no fixture authentication", async () => {
      const response = await fetch(fixture.baseUrl);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
      const html = await response.text();
      assert.match(html, /Share your work/);
      assert.match(html, /Slop Gallery/);
      assert.ok(!html.includes("Jan Demo") && !html.includes(new URL(fixture.runtimeUrl).password));
      for (const route of ["/.env", "/prisma/schema.prisma", "/api/auth/sign-up/email"])
        assert.equal((await fetch(fixture.baseUrl + route)).status, 404);
      if (fixture.webContainer) {
        const inspect = spawnSync("docker", ["inspect", fixture.webContainer], {
          encoding: "utf8",
        });
        const container = JSON.parse(inspect.stdout)[0];
        assert.equal(container.Config.User, "node");
        assert.equal(container.HostConfig.ReadonlyRootfs, true);
        assert.ok(
          !container.Config.Env.some((value: string) => value.startsWith("MIGRATION_DATABASE_URL")),
        );
        const probe = spawnSync("docker", [
          "exec",
          fixture.webContainer,
          "node",
          "-e",
          "const fs=require('fs'); process.exit(fs.existsSync('/workspace/node_modules/prisma') || fs.existsSync('/workspace/app/prisma/migrations') ? 1 : 0)",
        ]);
        assert.equal(probe.status, 0);
        const keyPermissions = spawnSync("docker", [
          "exec",
          fixture.webContainer,
          "node",
          "-e",
          "const fs=require('fs'),assert=require('assert/strict'),key=process.env.BRAG_CREDENTIAL_KEY_FILE,stat=fs.statSync(key); assert.equal(stat.uid,process.getuid()); assert.equal(stat.mode & 0o777,0o600); assert.equal(fs.readFileSync(key,'utf8').trim().length,44);",
        ]);
        assert.equal(keyPermissions.status, 0, "container key must stay private and runtime-owned");
        assert.equal(
          container.Mounts.find(
            (mount: { Destination: string }) => mount.Destination === "/run/credentials",
          )?.RW,
          false,
        );
        const invalid = spawnSync(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            `${fixture.container}-invalid`,
            "--network",
            "none",
            container.Image,
          ],
          {
            encoding: "utf8",
            timeout: 10000,
          },
        );
        assert.equal(invalid.status, 1, "missing runtime configuration must fail startup");
        assert.match(invalid.stdout + invalid.stderr, /BRAG_ENV/);
      }
    });
    await t.test("live is independent; missing schema is not ready", async () => {
      await status("/health/live", 200);
      await status("/health/ready", 503);
      assert.equal(await isDatabaseReady(db), false);
    });
    await t.test("migration deployment is repeatable and enables readiness", async () => {
      assert.equal(migrate().status, 0);
      assert.equal(migrate().status, 0);
      assert.equal(
        (await admin.query("SELECT count(*) FROM brag._prisma_migrations")).rows[0].count,
        "15",
      );
      await status("/health/ready", 200);
    });
    await t.test(
      "schema-5 upgrade preserves existing draft fields, IDs, versions and private pitch history",
      async () => {
        await admin.query("CREATE DATABASE brag_upgrade");
        const url = new URL(fixture.adminUrl);
        url.pathname = "/brag_upgrade";
        const upgrade = new pg.Client({ connectionString: url.toString() });
        await upgrade.connect();
        try {
          await upgrade.query(
            "CREATE SCHEMA brag AUTHORIZATION brag_migrator; GRANT USAGE ON SCHEMA brag TO brag_runtime; SET ROLE brag_migrator",
          );
          const root = "app/prisma/migrations";
          const dirs = (await readdir(root)).filter((name) => /^2026/.test(name)).sort();
          for (const name of dirs.slice(0, 5))
            await upgrade.query(await readFile(path.join(root, name, "migration.sql"), "utf8"));
          const event = randomUUID(),
            draftId = randomUUID(),
            pitchId = randomUUID();
          const oldFields = {
            title: "Before upgrade",
            problem: "Keep my work",
            description: "Private description",
            project_url: "https://example.test",
            repository_url: "",
          };
          await upgrade.query(
            `INSERT INTO brag.auth_user(id,name,email,"updatedAt") VALUES ('upgrade-user','Fixture','upgrade@example.test',now())`,
          );
          await upgrade.query(
            "INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation) VALUES ($1,'Fixture','UTC',now(),now()-interval '1 hour',now()+interval '1 day','approved',1,1)",
            [event],
          );
          await upgrade.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,version,fields) VALUES ($1,'upgrade-user',$2,7,$3)",
            [draftId, event, oldFields],
          );
          await upgrade.query(
            "INSERT INTO brag.voice_pitch(id,draft_id,owner_id,key,media_hash,base_version,policy,status,transcript,proposal) VALUES ($1,$2,'upgrade-user',$3,$4,7,'legacy','ready','Keep this transcript',$5)",
            [
              pitchId,
              draftId,
              randomUUID(),
              "a".repeat(64),
              { title: "Legacy suggestion", problem: "", description: "Private" },
            ],
          );
          await upgrade.query(await readFile(path.join(root, dirs[5], "migration.sql"), "utf8"));
          const row = (
            await upgrade.query("SELECT * FROM brag.project_draft WHERE id=$1", [draftId])
          ).rows[0];
          assert.equal(row.version, 7);
          assert.deepEqual(row.fields, {
            ...oldFields,
            schema_version: 1,
            details: emptyProject.details,
          });
          assert.deepEqual(row.last_edit, {});
          assert.equal(
            (await upgrade.query("SELECT transcript FROM brag.voice_pitch WHERE id=$1", [pitchId]))
              .rows[0].transcript,
            "Keep this transcript",
          );
          await upgrade.query("RESET ROLE; SET ROLE brag_runtime");
          await upgrade.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ($1,'upgrade-user',$2,$3)",
            [randomUUID(), event, emptyProject],
          );
          await upgrade.query(
            "UPDATE brag.project_draft SET last_edit='{}',fields=fields WHERE id=$1",
            [draftId],
          );
          await assert.rejects(
            upgrade.query("UPDATE brag.project_draft SET owner_id=owner_id"),
            (e: { code?: string }) => e.code === "42501",
          );
          await assert.rejects(
            upgrade.query("UPDATE brag.project_draft SET fields='{}' WHERE id=$1", [draftId]),
            (e: { code?: string }) => e.code === "23514",
          );
          assert.equal(
            (await upgrade.query("SELECT count(*) FROM brag.project_draft")).rows[0].count,
            "2",
          );
        } finally {
          await upgrade.end();
        }
      },
    );
    await t.test(
      "runtime cannot migrate, alter readiness metadata or become the migrator",
      async () => {
        for (const sql of [
          "CREATE TABLE brag.forbidden (id int)",
          "CREATE TABLE public.forbidden (id int)",
          "CREATE SCHEMA forbidden",
          "UPDATE brag.runtime_metadata SET schema_version = 15",
          "SELECT * FROM brag._prisma_migrations",
          "SET ROLE brag_migrator",
          "CREATE ROLE forbidden",
        ]) {
          await assert.rejects(
            runtime.query(sql),
            (error: { code?: string }) => error.code === "42501",
          );
        }
        const wrong = migrate(process.env.BRAG_TEST_RUNTIME_FILE!);
        assert.notEqual(wrong.status, 0);
        assert.ok(wrong.output.includes("brag_migrator"));
        assert.ok(!wrong.output.includes(new URL(fixture.runtimeUrl).password));
      },
    );
    await t.test(
      "unexpected privilege expansion and wrong schema version fail readiness",
      async () => {
        await admin.query("GRANT CREATE ON SCHEMA brag TO brag_runtime");
        await status("/health/ready", 503);
        await admin.query("REVOKE CREATE ON SCHEMA brag FROM brag_runtime");
        await admin.query("UPDATE brag.runtime_metadata SET schema_version = 99");
        await status("/health/ready", 503);
        await admin.query("UPDATE brag.runtime_metadata SET schema_version = 15");
        await status("/health/ready", 200);
      },
    );
    await t.test("changed migration history is rejected before applying migrations", async () => {
      const saved = (
        await admin.query(
          "SELECT id, checksum FROM brag._prisma_migrations ORDER BY migration_name LIMIT 1",
        )
      ).rows[0];
      await admin.query("UPDATE brag._prisma_migrations SET checksum = 'altered' WHERE id = $1", [
        saved.id,
      ]);
      const changed = migrate();
      assert.notEqual(changed.status, 0);
      assert.match(changed.output, /applied migration has changed/);
      await admin.query("UPDATE brag._prisma_migrations SET checksum = $1 WHERE id = $2", [
        saved.checksum,
        saved.id,
      ]);
    });
    await identityChecks(t, fixture, db, admin, runtime);
    await t.test(
      "dump and restore preserve schema, migration receipts and runtime grants",
      async () => {
        await seedSharingRows(runtime);
        const legacyDraft = await db.projectDraft.findFirstOrThrow();
        const legacyCode = "BRAG-" + "A".repeat(24);
        await admin.query(
          "INSERT INTO brag.agent_handoff(code,draft_id,owner_id,expires_at,revoked) VALUES ($1,$2,$3,now()+interval '1 hour',true)",
          [legacyCode, legacyDraft.id, legacyDraft.ownerId],
        );
        await admin.query(
          "INSERT INTO brag.agent_request(id,code,secret_hash,verification_code,state,expires_at) VALUES ($1,$2,$3,'FIXTURE','declined',now()+interval '1 hour')",
          [randomUUID(), legacyCode, "a".repeat(64)],
        );

        const dump = spawnSync(
          "docker",
          ["exec", fixture.container, "pg_dump", "-U", "postgres", "-d", "brag", "-Fc"],
          { maxBuffer: 8 * 1024 * 1024 },
        );
        assert.equal(dump.status, 0);
        await admin.query("CREATE DATABASE brag_restore");
        await admin.query("REVOKE ALL ON DATABASE brag_restore FROM PUBLIC");
        await admin.query("GRANT CONNECT ON DATABASE brag_restore TO brag_runtime, brag_migrator");
        const restore = spawnSync(
          "docker",
          [
            "exec",
            "-i",
            fixture.container,
            "pg_restore",
            "-U",
            "postgres",
            "-d",
            "brag_restore",
            "--exit-on-error",
          ],
          { input: dump.stdout },
        );
        assert.equal(restore.status, 0);
        const url = new URL(fixture.runtimeUrl);
        url.pathname = "/brag_restore";
        const restored = createDatabase(url.toString());
        try {
          assert.equal(await isDatabaseReady(restored), true);
          for (const model of [
            "authorEvent",
            "authorEventMutation",
            "agentProposalUpload",
            "agentProposal",
            "processorConfig",
            "projectDraft",
            "voicePitch",
            "draftMutation",
            "agentHandoff",
            "agentRequest",
            "event",
            "eventSourceAlias",
            "eventAudit",
            "eventMutation",
          ] as const) {
            const before = await (
              db[model] as unknown as { findMany(): Promise<unknown[]> }
            ).findMany();
            const after = await (
              restored[model] as unknown as { findMany(): Promise<unknown[]> }
            ).findMany();
            const stable = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
            assert.ok(before.length > 0, model + " recovery must include records");
            assert.deepEqual(stable(after), stable(before));
          }
          const backupSql = spawnSync(
            "python3",
            [
              "-c",
              "import importlib.util,json; s=importlib.util.spec_from_file_location('b','deploy/runtime/backup-guest.py'); b=importlib.util.module_from_spec(s);s.loader.exec_module(b);print(json.dumps([b.record_hashes_sql(8),b.SHARING_CHECK_SQL,b.PUBLICATION_CHECK_SQL]))",
            ],
            { encoding: "utf8" },
          );
          assert.equal(backupSql.status, 0);
          const recoveredAdminUrl = new URL(fixture.adminUrl);
          recoveredAdminUrl.pathname = "/brag_restore";
          const recoveryAdmin = new pg.Client({ connectionString: recoveredAdminUrl.toString() });
          await recoveryAdmin.connect();
          try {
            for (const query of JSON.parse(backupSql.stdout)) {
              const before = (await admin.query(query)).rows[0].json_build_object;
              const after = (await recoveryAdmin.query(query)).rows[0].json_build_object;
              assert.deepEqual(
                after,
                before,
                "Packaged backup helper validates preserved data, confirmation/intake facts and privileges",
              );
              if ("sharingIntegrity" in before) {
                assert.equal(before.sharingIntegrity, true);
                assert.equal(before.sharingPrivileges, true);
              }
            }
          } finally {
            await recoveryAdmin.end();
          }
          const vault = credentialVault(
            Buffer.from(
              (
                await readFile(path.join(path.dirname(fixture.authFile), "credential-key"), "utf8")
              ).trim(),
              "base64",
            ),
          );
          const recoveredConfigs = await restored.processorConfig.findMany();
          assert.ok(recoveredConfigs.length > 0);
          for (const row of recoveredConfigs) assert.doesNotThrow(() => configSecrets(row, vault));
        } finally {
          await restored.$disconnect();
        }
      },
    );
    await t.test(
      "database outage returns bounded generic 503 while the process stays live",
      async () => {
        const stopped = spawnSync("docker", ["stop", "--time", "2", fixture.container]);
        assert.equal(stopped.status, 0);
        const started = Date.now();
        await status("/health/ready", 503);
        assert.ok(Date.now() - started < 5500);
        await status("/health/live", 200);
      },
    );
  } finally {
    await Promise.allSettled([admin.end(), runtime.end(), db.$disconnect()]);
  }
});
