import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";

export type Sealed = { v: 1; kid: string; iv: string; tag: string; data: string };
export function credentialVault(key: Buffer) {
  if (key.length !== 32) throw new Error("Invalid credential encryption key");
  const kid = createHash("sha256").update(key).digest("hex");
  return {
    seal(value: unknown, context: string): Sealed {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from("brag:processor:v1:" + context));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return {
        v: 1,
        kid,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      };
    },
    unseal(value: unknown, context: string): unknown {
      try {
        const box = value as Sealed;
        if (
          box.v !== 1 ||
          box.kid !== kid ||
          typeof box.data !== "string" ||
          box.data.length > 65536
        )
          throw new Error();
        const iv = Buffer.from(box.iv, "base64"),
          tag = Buffer.from(box.tag, "base64");
        if (iv.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
        decipher.setAAD(Buffer.from("brag:processor:v1:" + context));
        decipher.setAuthTag(tag);
        return JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(box.data, "base64")),
            decipher.final(),
          ]).toString("utf8"),
        );
      } catch {
        throw new Error("Credential storage unavailable");
      }
    },
    intent(value: unknown) {
      return createHmac("sha256", key)
        .update("brag:settings-intent:v1:")
        .update(JSON.stringify(value))
        .digest("hex");
    },
  };
}
export type CredentialVault = ReturnType<typeof credentialVault>;

// A separate, operator-provisioned key: never derive this from a session secret or store it in SQL.
export async function readCredentialVault(
  env: Record<string, string | undefined> = process.env,
): Promise<CredentialVault | null> {
  const path = env.BRAG_CREDENTIAL_KEY_FILE;
  if (!path) return null;
  if (!isAbsolute(path)) throw new Error("Credential key path must be absolute");
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 || (info.mode & 0o077) !== 0) throw new Error();
    const raw = (await file.readFile("utf8")).trim();
    if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error();
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32 || key.toString("base64") !== raw) throw new Error();
    return credentialVault(key);
  } catch {
    throw new Error("Credential encryption key unavailable or insecure permissions");
  } finally {
    await file?.close();
  }
}
