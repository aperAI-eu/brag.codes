import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readRuntimeConfig } from "../src/lib/config/runtime.ts";
import { databaseUrl } from "../src/lib/config/secrets.ts";

test("runtime accepts a file credential and rejects privileged or malformed configuration without echoing secrets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "brag-config-"));
  const file = path.join(directory, "database.url");
  const secret = "fixture-password-never-print";
  const authFile = path.join(directory, "auth-secret");
  await writeFile(authFile, "fixture-auth-secret-must-be-at-least-32-characters");
  await writeFile(file, `postgresql://brag_runtime:${secret}@127.0.0.1:5432/brag?schema=brag\n`, {
    mode: 0o600,
  });
  const valid = {
    BRAG_ENV: "local",
    APP_ORIGIN: "http://127.0.0.1:3200",
    DATABASE_URL_FILE: file,
    AUTH_SECRET_FILE: authFile,
  };
  try {
    assert.equal((await readRuntimeConfig(valid)).origin, valid.APP_ORIGIN);
    for (const overrides of [
      { BRAG_ENV: "" },
      { APP_ORIGIN: "https://example.com/path" },
      { APP_ORIGIN: "https://user:secret@example.com" },
      { BRAG_ENV: "test", APP_ORIGIN: "http://example.invalid" },
      { APP_ORIGIN: "http://192.168.1.1" },
      { MIGRATION_DATABASE_URL_FILE: file },
      { DATABASE_URL: secret },
      { POSTGRES_PASSWORD: secret },
      { DATABASE_URL_FILE: "relative.url" },
      { AUTH_SECRET_FILE: "" },
      { OPERATOR_DATABASE_URL_FILE: file },
      { GOOGLE_CLIENT_ID_FILE: file },
      { GITHUB_CLIENT_ID_FILE: file },
      { GITHUB_CLIENT_SECRET_FILE: file },
    ]) {
      await assert.rejects(readRuntimeConfig({ ...valid, ...overrides }), (error: Error) => {
        assert.ok(!error.message.includes(secret));
        return true;
      });
    }
    const githubId = path.join(directory, "github-id"),
      githubSecret = path.join(directory, "github-secret");
    await writeFile(githubId, "fixture-client-id");
    await writeFile(githubSecret, "fixture-client-secret");
    assert.equal((await readRuntimeConfig(valid)).github, undefined);
    const github = (
      await readRuntimeConfig({
        ...valid,
        GITHUB_CLIENT_ID_FILE: githubId,
        GITHUB_CLIENT_SECRET_FILE: githubSecret,
      })
    ).github;
    assert.deepEqual(github, {
      clientId: "fixture-client-id",
      clientSecret: "fixture-client-secret",
    });
    for (const value of [
      `postgresql://brag_migrator:${secret}@localhost/brag`,
      `postgresql://postgres:${secret}@localhost/brag`,
      `postgresql://brag_runtime:${secret}@localhost/cartho`,
      secret,
    ]) {
      assert.throws(
        () => databaseUrl(value, "brag_runtime"),
        (error: Error) => {
          assert.ok(!error.message.includes(secret));
          return true;
        },
      );
    }
    await writeFile(file, secret + "\nsecond-line");
    await assert.rejects(readRuntimeConfig(valid), /invalid value/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
