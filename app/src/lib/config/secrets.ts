import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export async function readSecret(name: string, path: string | undefined): Promise<string> {
  if (!path || !isAbsolute(path)) throw new Error(`${name} must name an absolute secret-file path`);
  let value: string;
  try {
    value = await readFile(path, "utf8");
  } catch {
    throw new Error(`${name} cannot be read`);
  }
  value = value.trim();
  if (!value || value.length > 16384 || /[\r\n\0]/.test(value))
    throw new Error(`${name} contains an invalid value`);
  return value;
}

export function databaseUrl(
  value: string,
  role: "brag_runtime" | "brag_migrator" | "brag_operator",
): string {
  try {
    const url = new URL(value);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      decodeURIComponent(url.username) !== role ||
      !url.password ||
      !url.hostname ||
      !/^\/brag(?:_[a-z0-9_]+)?$/.test(url.pathname) ||
      url.hash
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(`Database connection must use the ${role} role and a brag database`);
  }
}
