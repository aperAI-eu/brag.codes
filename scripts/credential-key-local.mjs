import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { readCredentialVault } from "../app/src/lib/config/vault.ts";
const directory = fileURLToPath(new URL("../.localfiles/runtime-dev/", import.meta.url));
const file = path.join(directory, "identity/credential-key");
let present = false;
try {
  await readFile(file);
  present = true;
} catch (e) {
  if (e.code !== "ENOENT") throw new Error("Credential key unavailable");
}
if (present) await readCredentialVault({ BRAG_CREDENTIAL_KEY_FILE: file });
else {
  const db = new pg.Client({
    connectionString: (await readFile(path.join(directory, "runtime-local.url"), "utf8")).trim(),
  });
  try {
    await db.connect();
    const exists = (await db.query("SELECT to_regclass('brag.processor_config') AS name")).rows[0]
      .name;
    if (
      exists &&
      Number((await db.query("SELECT count(*) FROM brag.processor_config")).rows[0].count)
    )
      throw new Error("Restore the existing encryption key; saved settings exist");
    await writeFile(file, randomBytes(32).toString("base64") + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    await db.end();
  }
}
console.log("Local credential encryption key ready (value not printed).");
