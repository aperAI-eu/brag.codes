import "server-only";
import { mkdir, writeFile, readFile, rename, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export function audioStore(directory: string) {
  const file = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid media reference");
    return path.join(directory, id + ".wav");
  };
  return {
    async put(id: string, bytes: Buffer) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const tmp = path.join(directory, randomUUID() + ".tmp");
      try {
        await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" });
        await rename(tmp, file(id));
      } finally {
        await rm(tmp, { force: true });
      }
    },
    async exists(id: string) {
      try {
        return (await stat(file(id))).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    read: (id: string) => readFile(file(id)),
    remove: (id: string) => rm(file(id), { force: true }),
    async expire(orphan?: (id: string) => Promise<boolean>) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(directory)) {
        if (!/^[a-f0-9-]{36}\.(wav|tmp)$/.test(name)) continue;
        const target = path.join(directory, name);
        try {
          if (
            (await stat(target)).mtimeMs < Date.now() - 86400000 &&
            (!orphan || name.endsWith(".tmp") || (await orphan(name.slice(0, -4))))
          )
            await rm(target, { force: true });
        } catch {
          /* A concurrent cleanup may remove it. */
        }
      }
    },
  };
}
