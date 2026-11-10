import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { migrateCandidate, type OwnedFixture } from "./fixtures/owned-migration.ts";
function helper(expression: string) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import importlib.util\ns=importlib.util.spec_from_file_location('m','deploy/runtime/maintenance.py')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(${expression})`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
export async function sharingRecoveryChecks(
  t: TestContext,
  fixture: OwnedFixture,
  admin: pg.Client,
  runtime: pg.Client,
  migrator: pg.Client,
) {
  await t.test(
    "maintenance admission fence settles prior writes, rejects late author mutations and allows old worker progress",
    async () => {
      const draft = (await admin.query("SELECT * FROM brag.project_draft LIMIT 1")).rows[0];
      const queued = (
        await admin.query("SELECT * FROM brag.voice_pitch WHERE status='queued' LIMIT 1")
      ).rows[0];
      await runtime.query("BEGIN");
      await runtime.query("UPDATE brag.project_draft SET fields=fields WHERE id=$1", [draft.id]);
      let installed = false;
      const installation = admin.query(helper("m.install_sql(6)")).then(() => {
        installed = true;
      });
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(installed, false, "fence must wait for the prior author transaction");
      await runtime.query("COMMIT");
      await installation;
      try {
        await assert.rejects(
          runtime.query("UPDATE brag.project_draft SET fields=fields WHERE id=$1", [draft.id]),
          /maintenance/,
        );
        await assert.rejects(
          runtime.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) SELECT gen_random_uuid(),owner_id,event_id,fields FROM brag.project_draft LIMIT 1",
          ),
          /maintenance/,
        );
        await assert.rejects(
          runtime.query(
            "UPDATE brag.voice_pitch SET status='structure_queued' WHERE status='ready'",
          ),
          /maintenance/,
        );
        await runtime.query(
          "UPDATE brag.voice_pitch SET status='dispatching',lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1",
          [queued.id],
        );
        await runtime.query(
          "UPDATE brag.voice_pitch SET status='transcribing',lease_until=NULL WHERE id=$1",
          [queued.id],
        );
        await runtime.query("UPDATE brag.voice_pitch SET status='structure_queued' WHERE id=$1", [
          queued.id,
        ]);
        await runtime.query(
          "UPDATE brag.voice_pitch SET status='structuring',lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1",
          [queued.id],
        );
        await runtime.query(
          "UPDATE brag.voice_pitch SET status='failed',lease_until=NULL WHERE id=$1",
          [queued.id],
        );
        const drained = (await admin.query(helper("m.DRAIN_SQL"))).rows[0].json_build_object;
        assert.equal(drained.fenced, true);
        assert.ok(drained.active > 0);
      } finally {
        await admin.query(helper("m.remove_sql(6)"));
        await admin.query("UPDATE brag.voice_pitch SET status=$2,lease_until=$3 WHERE id=$1", [
          queued.id,
          queued.status,
          queued.lease_until,
        ]);
      }
    },
  );
  await t.test(
    "transactional Prisma failure is recoverable only with exact history, unchanged schema and verified data",
    async () => {
      const checkpoint = path.join(path.dirname(fixture.migrationFile), "recovery-checkpoint.json");
      const schemaFingerprint = (
        await migrator.query(await readFile("deploy/runtime/recovery-query.sql", "utf8"))
      ).rows[0].fingerprint;
      const hashes = JSON.parse(
        (await migrator.query(await readFile("deploy/runtime/recovery-hashes.sql", "utf8"))).rows[0]
          .recovery_hashes,
      );
      const receipt = {
        preMigrationBackup: { restore: "passed", schemaVersion: 6, schemaFingerprint, ...hashes },
      };
      await writeFile(checkpoint, JSON.stringify(receipt), { mode: 0o600 });
      await admin.query(
        `CREATE FUNCTION public.fail_sharing_fixture() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='brag.agent_proposal') THEN RAISE EXCEPTION 'Synthetic migration failure after partial execution'; END IF; END $$; CREATE EVENT TRIGGER fail_sharing_fixture ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.fail_sharing_fixture();`,
      );
      try {
        const result = migrateCandidate(fixture);
        assert.notEqual(result.status, 0);
        assert.match(result.output, /Migration deployment failed/);
      } finally {
        await admin.query(
          "DROP EVENT TRIGGER fail_sharing_fixture; DROP FUNCTION public.fail_sharing_fixture()",
        );
      }
      assert.equal(
        (await admin.query("SELECT to_regclass('brag.author_event') AS links")).rows[0].links,
        null,
      );
      assert.equal(
        (await migrator.query(await readFile("deploy/runtime/recovery-query.sql", "utf8"))).rows[0]
          .fingerprint,
        schemaFingerprint,
      );
      const recover = () => {
        const args = fixture.migrationImage
          ? [
              "run",
              "--rm",
              "--network",
              fixture.network!,
              "--read-only",
              "--cap-drop",
              "ALL",
              "--tmpfs",
              "/tmp:size=32m,mode=1777",
              "--mount",
              `type=bind,source=${fixture.migrationDockerFile},target=/run/secrets/migration_url,readonly`,
              "--mount",
              `type=bind,source=${checkpoint},target=/run/checkpoint.json,readonly`,
              "-e",
              "MIGRATION_DATABASE_URL_FILE=/run/secrets/migration_url",
              fixture.migrationImage,
              "node",
              "--import",
              "tsx",
              "app/scripts/recover-sharing.ts",
              "/run/checkpoint.json",
            ]
          : ["--import", "tsx", "app/scripts/recover-sharing.ts", checkpoint];
        return spawnSync(fixture.migrationImage ? "docker" : process.execPath, args, {
          encoding: "utf8",
          timeout: 60000,
          env: { ...process.env, MIGRATION_DATABASE_URL_FILE: fixture.migrationFile },
        });
      };
      await admin.query("CREATE TABLE brag.partial_upgrade_fixture(id int)");
      assert.notEqual(recover().status, 0);
      await admin.query("DROP TABLE brag.partial_upgrade_fixture");
      await writeFile(
        checkpoint,
        JSON.stringify({
          preMigrationBackup: { ...receipt.preMigrationBackup, schemaFingerprint: "forged" },
        }),
      );
      assert.notEqual(recover().status, 0);
      await writeFile(checkpoint, JSON.stringify(receipt));
      const resolved = recover();
      assert.equal(resolved.status, 0, resolved.stderr);
      assert.match(resolved.stdout, /rolled_back/);
      assert.notEqual(
        recover().status,
        0,
        "a resolved migration cannot be marked rolled back repeatedly",
      );
    },
  );
}
