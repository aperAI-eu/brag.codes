import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event } from "./fixtures/sharing-history.ts";
import { uploadTransportChecks } from "./upload-transport.integration.ts";
test("owned HTTP/2 upload transport qualification", async (t) => {
  const f = await ownedFixture();
  assert.equal(migrateCandidate(f).status, 0);
  const db = new pg.Client({ connectionString: f.adminUrl });
  await db.connect();
  try {
    await identity(db, (await readFile(f.authFile, "utf8")).trim());
    const e = await event(db);
    await uploadTransportChecks(t, f, db, e.id, true);
  } finally {
    await db.end();
  }
});
