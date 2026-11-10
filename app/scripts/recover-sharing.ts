import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { readSecret, databaseUrl } from "../src/lib/config/secrets.ts";
const migration = "202611080007_sharing";
async function recover() {
  if (process.argv.length !== 3) throw new Error("Supply the verified pre-upgrade checkpoint file");
  const receipt = JSON.parse(await readFile(process.argv[2], "utf8")),
    checkpoint = receipt.preMigrationBackup;
  if (
    checkpoint?.restore !== "passed" ||
    checkpoint.schemaVersion !== 6 ||
    !checkpoint.schemaFingerprint ||
    !checkpoint.recordHashes
  )
    throw new Error("Verified schema-6 checkpoint required");
  const connectionString = databaseUrl(
    await readSecret("MIGRATION_DATABASE_URL_FILE", process.env.MIGRATION_DATABASE_URL_FILE),
    "brag_migrator",
  );
  const db = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  });
  try {
    await db.connect();
    await db.query("BEGIN");
    const locks = (
      await db.query(
        "SELECT format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE',n.nspname,c.relname) AS sql FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag' AND c.relkind='r' AND c.relname<>'_prisma_migrations' ORDER BY c.relname",
      )
    ).rows;
    for (const lock of locks) await db.query(lock.sql);
    const history = (
      await db.query(
        "SELECT migration_name,checksum,finished_at,rolled_back_at FROM brag._prisma_migrations ORDER BY migration_name,started_at",
      )
    ).rows;
    const active = history.filter((r) => !r.rolled_back_at),
      names = (await readdir("app/prisma/migrations")).filter((n) => /^2026/.test(n)).sort();
    if (
      active.length !== 7 ||
      names.length !== 15 ||
      active.at(-1).migration_name !== migration ||
      active.at(-1).finished_at
    )
      throw new Error("Expected only the known unfinished sharing migration");
    for (let i = 0; i < 7; i++) {
      const sql = await readFile(`app/prisma/migrations/${names[i]}/migration.sql`);
      if (
        active[i].migration_name !== names[i] ||
        active[i].checksum !== createHash("sha256").update(sql).digest("hex") ||
        (i < 6 && !active[i].finished_at)
      )
        throw new Error("Migration history or checksum mismatch");
    }
    if (
      (await db.query("SELECT schema_version FROM brag.runtime_metadata WHERE id=1")).rows[0]
        ?.schema_version !== 6
    )
      throw new Error("The previous schema was not restored by rollback");
    const fingerprint = (
      await db.query(await readFile("deploy/runtime/recovery-query.sql", "utf8"))
    ).rows[0].fingerprint;
    if (fingerprint !== checkpoint.schemaFingerprint)
      throw new Error("The prior schema, constraints or grants differ from the checkpoint");
    const hashes = JSON.parse(
      (await db.query(await readFile("deploy/runtime/recovery-hashes.sql", "utf8"))).rows[0]
        .recovery_hashes,
    );
    if (
      JSON.stringify(Object.entries(hashes.recordHashes).sort()) !==
      JSON.stringify(Object.entries(checkpoint.recordHashes).sort())
    )
      throw new Error("Protected data differs from the verified checkpoint");

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/prisma/build/index.js",
        "migrate",
        "resolve",
        "--rolled-back",
        migration,
        "--config",
        "app/prisma.config.ts",
      ],
      { env: process.env, stdio: "pipe", timeout: 60000 },
    );
    if (result.status !== 0) throw new Error("Prisma rollback resolution failed");
    const rows = (
      await db.query(
        "SELECT finished_at,rolled_back_at FROM brag._prisma_migrations WHERE migration_name=$1",
        [migration],
      )
    ).rows;
    if (rows.some((r) => r.finished_at || !r.rolled_back_at))
      throw new Error("Rollback history verification failed");
    await db.query("COMMIT");
  } finally {
    await db.end();
  }
  console.log(JSON.stringify({ recovery: "rolled_back", migration, schemaVersion: 6 }));
}
try {
  await recover();
} catch {
  console.error(
    "Sharing recovery refused: checkpoint, schema, data or migration history is not qualified. Keep static fallback and diagnose privately.",
  );
  process.exitCode = 1;
}
