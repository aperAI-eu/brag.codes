import { readFile, writeFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import pg from "pg";
import { readSecret, databaseUrl } from "../src/lib/config/secrets.ts";
import { exportDeletionLedger, replayDeletionLedger } from "../src/lib/deletion/recovery.ts";
async function main() {
  const [action, file] = process.argv.slice(2);
  if (
    !["export", "replay"].includes(action) ||
    !file ||
    !isAbsolute(file) ||
    process.argv.length !== 4
  )
    throw new Error("Use export or replay with an absolute private ledger path");
  const environment = process.env.BRAG_ENV || "";
  if (!["local", "test", "production"].includes(environment))
    throw new Error("Select the recovery environment");
  if (action === "replay" && process.env.BRAG_ISOLATED_RESTORE !== "1")
    throw new Error("Replay requires an isolated restore and a verified current ledger");
  const connectionString = databaseUrl(
    await readSecret("MIGRATION_DATABASE_URL_FILE", process.env.MIGRATION_DATABASE_URL_FILE),
    "brag_migrator",
  );
  const db = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
    statement_timeout: 30000,
  });
  try {
    await db.connect();
    if (action === "export") {
      const ledger = await exportDeletionLedger(db, environment);
      await writeFile(file, JSON.stringify(ledger), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ exported: ledger.deletions.length, environment }));
    } else {
      if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error("Ledger is too large");
      const result = await replayDeletionLedger(
        db,
        JSON.parse(await readFile(file, "utf8")),
        environment,
      );
      console.log(JSON.stringify(result));
    }
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error(
    "Deletion ledger operation failed. Keep the restore isolated; verify environment, credentials and ledger provenance.",
  );
  process.exitCode = 1;
});
