import "server-only";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function legalDocument(name: "privacy-policy" | "terms-of-service") {
  // next build app and next dev app can run with either repository or app cwd.
  const root = existsSync(path.join(process.cwd(), "content/legal"))
    ? process.cwd()
    : path.resolve(process.cwd(), "app");
  return readFile(path.join(root, "content/legal", `${name}.md`), "utf8");
}
