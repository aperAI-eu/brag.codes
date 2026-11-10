import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, draft } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { integrationChecks } from "./integrations.integration.ts";

test("processor configuration and bound worker attempts on an owned database", async (t) => {
  const f = await ownedFixture(),
    migration = migrateCandidate(f);
  assert.equal(migration.status, 0, migration.output);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  const runtime = new pg.Client({ connectionString: f.runtimeUrl });
  const db = createDatabase(f.runtimeUrl);
  await Promise.all([admin.connect(), runtime.connect()]);
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
    await runtime.end();
  });
  const config = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
  };
  const manager = await identity(admin, config.authSecret),
    author = await identity(admin, config.authSecret);
  await admin.query(
    'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES ($1,true,1,now())',
    [manager.owner],
  );
  const e = await event(admin);
  await draft(admin, author.owner, e.id);
  await integrationChecks(
    t,
    f,
    createAuth(db, config),
    db,
    admin,
    runtime,
    manager.cookie,
    author.cookie,
    config,
  );
});
