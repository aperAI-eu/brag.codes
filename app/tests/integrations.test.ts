import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { credentialVault, readCredentialVault } from "../src/lib/config/vault.ts";
import { settingsInput } from "../src/lib/integrations/settings.ts";

test("credential encryption randomizes ciphertext and authenticates revision, key and payload", () => {
  const vault = credentialVault(randomBytes(32)),
    value = { token: "private-service-key" };
  const sealed = vault.seal(value, "revision-1");
  assert.deepEqual(vault.unseal(sealed, "revision-1"), value);
  assert.notDeepEqual(sealed, vault.seal(value, "revision-1"));
  assert.ok(!JSON.stringify(sealed).includes(value.token));
  assert.throws(() => vault.unseal(sealed, "revision-2"), /Credential storage unavailable/);
  assert.throws(() => credentialVault(randomBytes(32)).unseal(sealed, "revision-1"));
  for (const field of ["tag", "iv", "data"] as const) {
    const bytes = Buffer.from(sealed[field], "base64");
    bytes[0] ^= 1;
    assert.throws(() =>
      vault.unseal({ ...sealed, [field]: bytes.toString("base64") }, "revision-1"),
    );
  }
  assert.equal(vault.intent(value), vault.intent(value));
  assert.notEqual(vault.intent(value), vault.intent({ token: "replacement" }));
});
test("master key requires a private regular file and never silently regenerates", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "brag-vault-"));
  try {
    assert.equal(await readCredentialVault({}), null);
    const file = path.join(directory, "key"),
      env = { BRAG_CREDENTIAL_KEY_FILE: file };
    await assert.rejects(readCredentialVault(env), /key unavailable/);
    await writeFile(file, randomBytes(32).toString("base64"), { mode: 0o600 });
    assert.ok(await readCredentialVault(env));
    await chmod(file, 0o644);
    await assert.rejects(readCredentialVault(env));
    await chmod(file, 0o600);
    await symlink(file, path.join(directory, "link"));
    await assert.rejects(
      readCredentialVault({ BRAG_CREDENTIAL_KEY_FILE: path.join(directory, "link") }),
    );
    await writeFile(file, "invalid key");
    await assert.rejects(readCredentialVault(env));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("settings distinguish keep, replace and remove and reject malformed destinations or secrets", () => {
  const base = {
    expected_version: 0,
    enabled: false,
    distill_origin: "https://distill.example.test/",
    claude_model: "claude-test-20260101",
  };
  assert.equal(settingsInput(base).distill_origin, "https://distill.example.test");
  assert.equal(settingsInput(base).distill_token, undefined);
  assert.equal(settingsInput({ ...base, distill_token: null }).distill_token, null);
  for (const token of ["", "short", "long-enough-token\n", "token with spaces here"])
    assert.throws(() => settingsInput({ ...base, distill_token: token }));
  for (const origin of [
    "http://provider.example",
    "https://127.0.0.1",
    "https://localhost",
    "https://host.internal",
    "https://name:secret@provider.example",
    "https://provider.example/api",
    "https://provider.example/?key=x",
  ])
    assert.throws(() => settingsInput({ ...base, distill_origin: origin }));
  assert.throws(() => settingsInput({ ...base, claude_model: "claude-latest" }));
  assert.throws(() => settingsInput({ ...base, sealed: {} }));
});
