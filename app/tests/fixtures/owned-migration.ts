import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

export type OwnedFixture = {
  container: string;
  runtimeUrl: string;
  migrationUrl: string;
  adminUrl: string;
  migrationFile: string;
  baseUrl: string;
  authFile: string;
  network?: string;
  migrationImage?: string;
  migrationDockerFile?: string;
};
export async function ownedFixture(): Promise<OwnedFixture> {
  const fixture = JSON.parse(await readFile(process.env.BRAG_TEST_FIXTURE_FILE!, "utf8"));
  assert.match(fixture.container, /^brag-runtime-check-[a-z0-9-]+$/);
  for (const key of ["runtimeUrl", "migrationUrl", "adminUrl"])
    assert.equal(new URL(fixture[key]).hostname, "127.0.0.1");
  return fixture;
}
function run(fixture: OwnedFixture, args: string[]) {
  const result = spawnSync(process.execPath, args, {
    env: { ...process.env, MIGRATION_DATABASE_URL_FILE: fixture.migrationFile },
    encoding: "utf8",
    timeout: 60000,
  });
  let output = result.stdout + result.stderr;
  for (const value of [fixture.runtimeUrl, fixture.migrationUrl, fixture.adminUrl]) {
    output = output.replaceAll(value, "[owned database]");
    output = output.replaceAll(decodeURIComponent(new URL(value).password), "[credential]");
  }
  return { status: result.status, output };
}
export function migrateCandidate(fixture: OwnedFixture) {
  if (fixture.migrationImage) {
    assert.match(fixture.migrationImage, /^sha256:[a-f0-9]{64}$/);
    assert.equal(fixture.network, fixture.container + "-network");
    assert.ok(fixture.migrationDockerFile);
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        `${fixture.container}-migration`,
        "--network",
        fixture.network,
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
      { encoding: "utf8", timeout: 60000 },
    );
    // The migration wrapper sanitizes database diagnostics in both modes.
    return { status: result.status, output: result.stdout + result.stderr };
  }
  return run(fixture, ["--import", "tsx", "app/scripts/migrate.ts"]);
}
/** Run real Prisma against a copied immutable schema-6 history, never hide a migration in the repo. */
export const bootstrapSchema14 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 14);
export const bootstrapSchema13 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 13);
export const bootstrapSchema12 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 12);
export const bootstrapSchema6 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 6);
export const bootstrapSchema10 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 10);
export const bootstrapSchema9 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 9);
export const bootstrapSchema8 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 8);
export const bootstrapSchema7 = (fixture: OwnedFixture) => bootstrapHistory(fixture, 7);
async function bootstrapHistory(fixture: OwnedFixture, version: number) {
  const directory = path.join(path.dirname(fixture.migrationFile), "schema" + version);
  const source = path.resolve("app/prisma/migrations");
  await mkdir(path.join(directory, "migrations"), { recursive: true });
  const names = (await readdir(source)).filter((name) => /^2026/.test(name)).sort();
  assert.equal(names[5], "202611080006_structured_projects");
  for (const name of [...names.slice(0, version), "migration_lock.toml"])
    await cp(path.join(source, name), path.join(directory, "migrations", name), {
      recursive: true,
    });
  const config = path.join(directory, "prisma.config.ts");
  await writeFile(
    config,
    `import { readFileSync } from 'node:fs';\nexport default { schema: ${JSON.stringify(path.resolve("app/prisma/schema.prisma"))}, migrations: { path: './migrations' }, datasource: { url: readFileSync(process.env.MIGRATION_DATABASE_URL_FILE!, 'utf8').trim() } };\n`,
  );
  const result = run(fixture, [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--config",
    config,
  ]);
  assert.equal(result.status, 0, result.output);
}
export async function restoreOwned(fixture: OwnedFixture, database: string) {
  assert.match(database, /^brag_restore_[a-z]+$/);
  const dump = spawnSync(
    "docker",
    ["exec", fixture.container, "pg_dump", "-U", "postgres", "-d", "brag", "-Fc"],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(dump.status, 0);
  const admin = new pg.Client({ connectionString: fixture.adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO brag_runtime, brag_migrator`);
  } finally {
    await admin.end();
  }
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
      database,
      "--exit-on-error",
    ],
    { input: dump.stdout },
  );
  assert.equal(restore.status, 0);
  const url = new URL(fixture.runtimeUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
