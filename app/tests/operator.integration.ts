import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { administerRole, parseRoleCommand } from "../src/lib/administration/roles.ts";

test("operator GitHub bootstrap preserves explicit identity, privileges and legacy receipts", async () => {
  const f = (await ownedFixture()) as Awaited<ReturnType<typeof ownedFixture>> & {
    operatorUrl: string;
  };
  assert.equal(new URL(f.operatorUrl).hostname, "127.0.0.1");
  assert.equal(migrateCandidate(f).status, 0);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const operator = createDatabase(f.operatorUrl),
    runtime = createDatabase(f.runtimeUrl);
  const directory = await mkdtemp(path.join(tmpdir(), "brag-operator-"));
  try {
    const userId = randomUUID(),
      googleId = randomUUID();
    for (const [id, provider, subject, issuer] of [
      [userId, "github", "123456789", "https://github.com"],
      [googleId, "google", "google-existing", "https://accounts.google.com"],
    ]) {
      await admin.query(
        'INSERT INTO brag.auth_user(id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())',
        [id, provider, provider + "@example.test"],
      );
      await admin.query(
        'INSERT INTO brag.auth_account(id,"accountId","providerId","userId",issuer,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
        [randomUUID(), subject, provider, id, issuer],
      );
    }
    const command = {
      requestId: randomUUID(),
      environment: "local",
      action: "bootstrap",
      userId,
      expectedVersion: 0,
      operator: "fixture",
      reason: "Explicit initial administrator",
      evidence: "Owner independently confirmed account ID",
      providerId: "github",
      providerSubject: "123456789",
    };
    const setup = { environment: "local", bootstrapUserId: userId };
    const status = (expected: number) => (e: { status?: number }) => e.status === expected;
    await assert.rejects(administerRole(runtime, command, setup), status(403));
    await assert.rejects(
      administerRole(operator, command, { ...setup, environment: "production" }),
      status(400),
    );
    await assert.rejects(
      administerRole(operator, command, { ...setup, bootstrapUserId: googleId }),
      status(409),
    );
    await assert.rejects(
      administerRole(operator, command, {
        environment: "local",
        bootstrapEmail: "github@example.test",
      }),
      status(409),
    );
    await assert.rejects(
      administerRole(operator, { ...command, providerId: "google" }, setup),
      status(403),
    );
    await assert.rejects(
      administerRole(operator, { ...command, providerSubject: "another" }, setup),
      status(403),
    );
    assert.throws(() => parseRoleCommand({ ...command, googleSubject: "ambiguous" }));
    assert.throws(() => parseRoleCommand({ ...command, providerId: "unqualified" }));
    await admin.query('UPDATE brag.auth_user SET "emailVerified"=false WHERE id=$1', [userId]);
    await assert.rejects(administerRole(operator, command, setup), status(409));
    await admin.query('UPDATE brag.auth_user SET "emailVerified"=true,active=false WHERE id=$1', [
      userId,
    ]);
    await assert.rejects(administerRole(operator, command, setup), status(403));
    await admin.query("UPDATE brag.auth_user SET active=true WHERE id=$1", [userId]);
    const urlFile = path.join(directory, "operator.url"),
      targetFile = path.join(directory, "target"),
      commandFile = path.join(directory, "command.json");
    await writeFile(urlFile, f.operatorUrl, { mode: 0o600 });
    await writeFile(targetFile, userId, { mode: 0o600 });
    await writeFile(commandFile, JSON.stringify(command), { mode: 0o600 });
    const cli = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "app/scripts/admin-role.ts",
        "apply",
        commandFile,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BRAG_ENV: "local",
          OPERATOR_DATABASE_URL_FILE: urlFile,
          BOOTSTRAP_USER_ID_FILE: targetFile,
        },
      },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).version, 1);
    const retries = await Promise.all([
      administerRole(operator, command, setup),
      administerRole(operator, command, setup),
    ]);
    assert.ok(retries.every((r) => r.replay));
    assert.equal(await operator.roleAudit.count(), 1);
    await assert.rejects(
      administerRole(operator, { ...command, reason: "Changed" }, setup),
      status(409),
    );
    const legacy = {
      requestId: randomUUID(),
      environment: "local",
      action: "grant",
      userId: googleId,
      expectedVersion: 0,
      operator: "fixture",
      reason: "Legacy Google grant",
      evidence: "Confirmed Google subject",
      googleSubject: "google-existing",
    };
    await administerRole(operator, legacy, setup);
    const receipt = await operator.roleAudit.findUniqueOrThrow({
      where: { requestId: legacy.requestId },
    });
    assert.equal(
      receipt.commandHash,
      createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
    );
    assert.equal((await administerRole(operator, legacy, setup)).replay, true);
    await administerRole(
      operator,
      { ...command, requestId: randomUUID(), action: "revoke", expectedVersion: 1 },
      setup,
    );
    await assert.rejects(
      administerRole(operator, { ...command, requestId: randomUUID(), expectedVersion: 2 }, setup),
      status(409),
    );
    await assert.rejects(
      administerRole(
        operator,
        { ...command, requestId: randomUUID(), action: "grant", expectedVersion: 1 },
        setup,
      ),
      status(409),
    );
    await administerRole(
      operator,
      { ...command, requestId: randomUUID(), action: "grant", expectedVersion: 2 },
      setup,
    );
    assert.equal((await operator.platformRole.findUniqueOrThrow({ where: { userId } })).version, 3);
  } finally {
    await operator.$disconnect();
    await runtime.$disconnect();
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
