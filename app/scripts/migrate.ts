import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { readSecret, databaseUrl } from "../src/lib/config/secrets.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
async function migrate() {
  const connectionString = databaseUrl(
    await readSecret("MIGRATION_DATABASE_URL_FILE", process.env.MIGRATION_DATABASE_URL_FILE),
    "brag_migrator",
  );
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    const table = await client.query("SELECT to_regclass('brag._prisma_migrations') AS table_name");
    if (table.rows[0].table_name) {
      const history = await client.query(
        "SELECT migration_name, checksum, finished_at, rolled_back_at FROM brag._prisma_migrations",
      );
      const directory = path.join(root, "app/prisma/migrations");
      const names = await readdir(directory);
      for (const row of history.rows) {
        if (row.rolled_back_at) continue;
        if (!row.finished_at || !names.includes(row.migration_name))
          throw new Error("Migration history is incomplete or contains an unknown revision");
        const sql = await readFile(path.join(directory, row.migration_name, "migration.sql"));
        if (createHash("sha256").update(sql).digest("hex") !== row.checksum)
          throw new Error(
            "An applied migration has changed; restore the immutable migration before proceeding",
          );
      }
    }
  } finally {
    await client.end();
  }
  const args = [
    path.join(root, "node_modules/prisma/build/index.js"),
    "migrate",
    "deploy",
    "--config",
    "app/prisma.config.ts",
  ];
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const redact = (data: Buffer) => {
      const secret = decodeURIComponent(new URL(connectionString).password);
      process.stdout.write(
        data
          .toString()
          .replaceAll(connectionString, "[database URL]")
          .replaceAll(secret, "[credential]"),
      );
    };
    child.stdout.on("data", redact);
    child.stderr.on("data", redact);
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (result !== 0) throw new Error("Migration deployment failed");
}

try {
  await migrate();
} catch (error) {
  // PostgreSQL errors can contain connection details. Emit only application-owned
  // categories; the operator can inspect the restricted DB logs separately.
  const message = error instanceof Error ? error.message : "";
  const safe = [
    "Migration history is incomplete",
    "An applied migration has changed",
    "Migration deployment failed",
    "MIGRATION_DATABASE_URL_FILE",
    "Database connection must use",
  ].some((prefix) => message.startsWith(prefix));
  console.error(
    safe
      ? message
      : "Migration preflight failed; check database availability and migration credentials",
  );
  process.exitCode = 1;
}
