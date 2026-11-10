import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, ".localfiles/runtime-dev");
const mode = process.argv[2];
if (mode === "setup") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try {
    await access(path.join(directory, "postgres.env"));
  } catch {
    const password = () => randomBytes(32).toString("hex");
    const postgres = password(),
      migrator = password(),
      runtime = password();
    const files = {
      "postgres.env": `POSTGRES_PASSWORD=${postgres}\nBRAG_MIGRATOR_PASSWORD=${migrator}\nBRAG_RUNTIME_PASSWORD=${runtime}\n`,
    };
    for (const [name, user, secret] of [
      ["runtime", "brag_runtime", runtime],
      ["migration", "brag_migrator", migrator],
    ]) {
      files[`${name}-docker.url`] =
        `postgresql://${user}:${secret}@database:5432/brag?schema=brag\n`;
      files[`${name}-local.url`] =
        `postgresql://${user}:${secret}@127.0.0.1:55432/brag?schema=brag\n`;
    }
    // Refuse overwriting credentials for an existing volume. Recover incomplete
    // setup explicitly; never silently rotate just part of this credential set.
    for (const [name, value] of Object.entries(files))
      await writeFile(path.join(directory, name), value, {
        mode: name.endsWith("-docker.url") ? 0o444 : 0o600,
        flag: "wx",
      });
  }
  for (const name of [
    "postgres.env",
    "runtime-local.url",
    "migration-local.url",
    "runtime-docker.url",
    "migration-docker.url",
  ])
    await readFile(path.join(directory, name));
  const postgresEnv = await readFile(path.join(directory, "postgres.env"), "utf8");
  if (!postgresEnv.includes("BRAG_OPERATOR_PASSWORD=")) {
    const secret = randomBytes(32).toString("hex");
    for (const [suffix, host, port] of [
      ["local", "127.0.0.1", 55432],
      ["docker", "database", 5432],
    ]) {
      await writeFile(
        path.join(directory, `operator-${suffix}.url`),
        `postgresql://brag_operator:${secret}@${host}:${port}/brag?schema=brag\n`,
        { mode: 0o600, flag: "wx" },
      );
    }
    await writeFile(
      path.join(directory, "postgres.env"),
      postgresEnv + `BRAG_OPERATOR_PASSWORD=${secret}\n`,
      { mode: 0o600 },
    );
  }
  await readFile(path.join(directory, "operator-local.url"));
  const identity = path.join(directory, "identity");
  await mkdir(identity, { recursive: true, mode: 0o755 });
  try {
    await writeFile(path.join(identity, "session-secret"), randomBytes(48).toString("hex") + "\n", {
      mode: 0o444,
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  console.log("Local credentials prepared in .localfiles/runtime-dev (values not printed).");
} else if (mode === "dev" || mode === "start" || mode === "migrate") {
  const env = { ...process.env };
  if (mode === "migrate") {
    env.MIGRATION_DATABASE_URL_FILE ||= path.join(directory, "migration-local.url");
  } else {
    env.BRAG_ENV ||= "local";
    env.APP_ORIGIN ||= "http://127.0.0.1:3200";
    env.DATABASE_URL_FILE ||= path.join(directory, "runtime-local.url");
    env.BRAG_CREDENTIAL_KEY_FILE ||= path.join(directory, "identity/credential-key");
    env.BRAG_PITCH_AUDIO_DIR ||= path.join(directory, "pitches");
    env.AUTH_SECRET_FILE ||= path.join(directory, "identity/session-secret");
    for (const [key, file] of [
      ["GOOGLE_CLIENT_ID_FILE", "google-client-id"],
      ["GOOGLE_CLIENT_SECRET_FILE", "google-client-secret"],
      ["GITHUB_CLIENT_ID_FILE", "github-client-id"],
      ["GITHUB_CLIENT_SECRET_FILE", "github-client-secret"],
    ]) {
      try {
        await access(path.join(directory, "identity", file));
        env[key] ||= path.join(directory, "identity", file);
      } catch {}
    }
    const { readRuntimeConfig } = await import("../app/src/lib/config/runtime.ts");
    await readRuntimeConfig(env);
  }
  const args =
    mode === "migrate"
      ? ["--import", "tsx", "app/scripts/migrate.ts"]
      : [
          "node_modules/next/dist/bin/next",
          mode,
          "app",
          "--hostname",
          "127.0.0.1",
          "--port",
          "3200",
        ];
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  throw new Error("Use setup, dev, start or migrate");
}
