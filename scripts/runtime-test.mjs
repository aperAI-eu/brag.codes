import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const name = `brag-runtime-check-${process.pid}-${randomBytes(4).toString("hex")}`;
const directory = path.join(root, ".localfiles", name);
const imageIndex = process.argv.indexOf("--image"),
  migrationIndex = process.argv.indexOf("--migration-image");
const image = imageIndex > -1 ? process.argv[imageIndex + 1] : undefined;
const migrationImage = migrationIndex > -1 ? process.argv[migrationIndex + 1] : undefined;
const suiteIndex = process.argv.indexOf("--suite");
const suite = suiteIndex > -1 ? process.argv[suiteIndex + 1] : "full";
const suites = {
  "optional-events": "optional-events.integration.ts",
  "optional-events-browser": "optional-events-browser.integration.ts",
  full: "runtime.integration.ts",
  runtime: "runtime.integration.ts",
  mobile: "mobile.integration.ts",
  integrations: "integrations-run.integration.ts",
  publication: "publication.integration.ts",
  moderation: "moderation.integration.ts",
  "moderation-browser": "moderation-browser.integration.ts",
  lifecycle: "publication-lifecycle.integration.ts",
  "lifecycle-browser": "publication-lifecycle-browser.integration.ts",
  deletion: "deletion.integration.ts",
  gallery: "gallery.integration.ts",
  "deletion-browser": "deletion-browser.integration.ts",
  github: "github.integration.ts",
  operator: "operator.integration.ts",
  "agent-refinement": "agent-refinement.integration.ts",
  "pitch-recovery": "pitch-recovery.integration.ts",
  "publication-browser": "publication-browser.integration.ts",
  "sharing-cutover": "sharing-cutover.integration.ts",
  "upload-transport": "upload-transport-run.integration.ts",
  "upload-http2": "upload-http2-run.integration.ts",
  "sharing-migration": "sharing-migration.integration.ts",
  "sharing-history": "sharing-history.integration.ts",
};
if (!Object.hasOwn(suites, suite))
  throw new Error("Unknown runtime suite; use full, sharing-migration or sharing-history");
if (suite === "sharing-migration" && (image || migrationImage))
  throw new Error("Focused migration checks use local sources and an owned database only");
if (Boolean(image) !== Boolean(migrationImage))
  throw new Error("Supply both immutable web and migration image IDs");
const needsServer = ![
  "optional-events",
  "operator",
  "sharing-migration",
  "sharing-cutover",
  "publication",
  "lifecycle",
  "moderation",
  "deletion",
].includes(suite);
if (
  image &&
  (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^sha256:[a-f0-9]{64}$/.test(migrationImage || ""))
)
  throw new Error("Container checks require immutable web and migration image IDs");
const network = `${name}-network`,
  webContainer = `${name}-web`,
  credentialVolume = `${name}-credentials`;
const passwords = {
  admin: randomBytes(24).toString("hex"),
  migrator: randomBytes(24).toString("hex"),
  runtime: randomBytes(24).toString("hex"),
  operator: randomBytes(24).toString("hex"),
  auth: randomBytes(48).toString("hex"),
};
let server;
let testChild;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    testChild?.kill("SIGTERM");
    server?.kill("SIGTERM");
  });
function checkInterrupted() {
  if (interrupted) throw new Error("Runtime check interrupted; removing owned resources");
}
const diagnostics = [];
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Owned test container command failed: ${args[0]}`);
  return result.stdout.trim();
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
try {
  if (needsServer && !image) await readFile(path.join(root, "app/.next/BUILD_ID"));
  if (suite === "full") {
    const responseProbe = await new Promise((resolve, reject) => {
      testChild = spawn(process.execPath, ["deploy/runtime/proxy-response-test.mjs"], {
        cwd: root,
        env: process.env,
        stdio: "inherit",
      });
      testChild.once("error", reject);
      testChild.once("exit", (code) => resolve(code ?? 1));
    });
    if (responseProbe !== 0) throw new Error("Incomplete upload error response");
    checkInterrupted();
    // Upgrade fixtures require their own schema-6 starting point. Keep them in the
    // default qualification chain without pre-migrating its separate empty DB.
    for (const focusedSuite of [
      "optional-events",
      "optional-events-browser",
      "operator",
      "sharing-migration",
      "sharing-history",
      "publication",
      "lifecycle",
      "lifecycle-browser",
      "moderation",
      "moderation-browser",
      "mobile",
      "deletion",
      "deletion-browser",
      "gallery",
      "publication-browser",
      "pitch-recovery",
      "agent-refinement",
      "github",
    ]) {
      const result = await new Promise((resolve, reject) => {
        testChild = spawn(
          process.execPath,
          [
            "scripts/runtime-test.mjs",
            "--suite",
            focusedSuite,
            ...(image &&
            [
              "sharing-history",
              "publication-browser",
              "lifecycle-browser",
              "moderation-browser",
              "mobile",
              "deletion-browser",
              "gallery",
              "agent-refinement",
              "github",
            ].includes(focusedSuite)
              ? ["--image", image, "--migration-image", migrationImage]
              : []),
          ],
          {
            cwd: root,
            env: process.env,
            stdio: "inherit",
          },
        );
        testChild.once("error", reject);
        testChild.once("exit", (code) => resolve(code ?? 1));
      });
      if (result !== 0) throw new Error(`Sharing qualification failed: ${focusedSuite}`);
      checkInterrupted();
    }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const envFile = path.join(directory, "postgres.env");
  await writeFile(
    envFile,
    `POSTGRES_PASSWORD=${passwords.admin}\nBRAG_MIGRATOR_PASSWORD=${passwords.migrator}\nBRAG_RUNTIME_PASSWORD=${passwords.runtime}\nBRAG_OPERATOR_PASSWORD=${passwords.operator}\nPOSTGRES_DB=brag\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256\n`,
    { mode: 0o600 },
  );
  docker(["network", "create", network]);
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "--label",
    "codes.brag.test=runtime",
    "--network",
    network,
    "--network-alias",
    "database",
    "--memory",
    "256m",
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--env-file",
    envFile,
    "--mount",
    `type=bind,source=${path.join(root, "deploy/runtime/init-db.sh")},target=/docker-entrypoint-initdb.d/10-brag.sh,readonly`,
    "-p",
    "127.0.0.1::5432",
    "postgres:18.6-bookworm@sha256:5c4783a8cc3f0074912164f94dfa1be4e043438f0f707cf968d7af9a0d31a2c8",
  ]);
  const port = docker(["port", name, "5432/tcp"]).split(":").at(-1);
  const url = (user, secret) => `postgresql://${user}:${secret}@127.0.0.1:${port}/brag?schema=brag`;
  const runtimeUrl = url("brag_runtime", passwords.runtime),
    migrationUrl = url("brag_migrator", passwords.migrator),
    adminUrl = url("postgres", passwords.admin);
  let connected = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    checkInterrupted();
    const probe = new pg.Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 500 });
    try {
      await probe.connect();
      connected = true;
    } catch {
    } finally {
      await probe.end();
    }
    if (connected) break;
    await pause(500);
  }
  if (!connected) throw new Error("Owned test database did not initialize");
  const runtimeFile = path.join(directory, "runtime.url"),
    migrationFile = path.join(directory, "migration.url");
  await writeFile(runtimeFile, runtimeUrl, { mode: 0o600 });
  await writeFile(migrationFile, migrationUrl, { mode: 0o600 });
  const authFile = path.join(directory, "auth-secret");
  await writeFile(authFile, passwords.auth, { mode: 0o444 });
  const credentialFile = path.join(directory, "credential-key");
  await writeFile(credentialFile, randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
  const webPort = await freePort(),
    baseUrl = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    BRAG_ENV: "local",
    APP_ORIGIN: baseUrl,
    DATABASE_URL_FILE: runtimeFile,
    AUTH_SECRET_FILE: authFile,
    BRAG_CREDENTIAL_KEY_FILE: credentialFile,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  for (const key of [
    "BRAG_PITCH_AUDIO_DIR",
    "BRAG_PITCH_WORKER_PAUSED",
    "BRAG_PITCH_CONFIG_FILE",
    "BRAG_DISTILL_ORIGIN",
    "BRAG_DISTILL_TOKEN_FILE",
    "BRAG_ANTHROPIC_KEY_FILE",
    "BRAG_CLAUDE_MODEL",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "MIGRATION_DATABASE_URL_FILE",
    "POSTGRES_PASSWORD",
    "POSTGRES_PASSWORD_FILE",
    "OPERATOR_DATABASE_URL",
    "OPERATOR_DATABASE_URL_FILE",
    "GOOGLE_CLIENT_ID_FILE",
    "GOOGLE_CLIENT_SECRET_FILE",
    "GITHUB_CLIENT_ID_FILE",
    "GITHUB_CLIENT_SECRET_FILE",
  ])
    delete env[key];
  const githubMock = path.join(root, "app/tests/fixtures/github-provider.mjs");
  const githubId = path.join(directory, "github-client-id");
  const githubSecret = path.join(directory, "github-client-secret");
  if (suite === "github") {
    await writeFile(githubId, "fixture-http-github", { mode: 0o444 });
    await writeFile(githubSecret, "fixture-http-secret", { mode: 0o444 });
    env.GITHUB_CLIENT_ID_FILE = githubId;
    env.GITHUB_CLIENT_SECRET_FILE = githubSecret;
  }
  // Exercise read-time expiry independently of background maintenance.
  env.BRAG_PITCH_WORKER_PAUSED = "1";
  env.BRAG_PITCH_AUDIO_DIR = path.join(directory, "http-pitches");
  await mkdir(env.BRAG_PITCH_AUDIO_DIR, { mode: 0o700 });
  const runtimeDockerFile = path.join(directory, "runtime-docker.url"),
    migrationDockerFile = path.join(directory, "migration-docker.url");
  // Host traversal is denied by the private parent; mounted files remain readable by UID 1000.
  await writeFile(
    runtimeDockerFile,
    `postgresql://brag_runtime:${passwords.runtime}@database:5432/brag?schema=brag`,
    { mode: 0o444 },
  );
  await writeFile(
    migrationDockerFile,
    `postgresql://brag_migrator:${passwords.migrator}@database:5432/brag?schema=brag`,
    { mode: 0o444 },
  );
  if (image) {
    // CI's host UID can differ from the image's node UID. Keep the host key private
    // and provision an equally private container-owned copy, as TEST does.
    docker(["volume", "create", "--label", "codes.brag.test=runtime", credentialVolume]);
    const provision = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--name",
        `${name}-credentials`,
        "--network",
        "none",
        "--read-only",
        "--user",
        "0",
        "--cap-drop",
        "ALL",
        "--cap-add",
        "CHOWN",
        "--security-opt",
        "no-new-privileges:true",
        "--mount",
        `type=volume,source=${credentialVolume},target=/credentials`,
        "--entrypoint",
        "node",
        image,
        "-e",
        "const fs=require('fs'); fs.writeFileSync('/credentials/key',fs.readFileSync(0),{mode:0o600,flag:'wx'}); fs.chownSync('/credentials/key',1000,1000);",
      ],
      { input: await readFile(credentialFile), stdio: ["pipe", "ignore", "ignore"] },
    );
    if (provision.status !== 0) throw new Error("Owned container credential provisioning failed");
    docker([
      "run",
      "-d",
      "--name",
      webContainer,
      "--network",
      network,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--tmpfs",
      "/tmp:size=32m,mode=1777",
      "--memory",
      "384m",
      "--pids-limit",
      "128",
      "--mount",
      `type=bind,source=${runtimeDockerFile},target=/run/secrets/database_url,readonly`,
      "--mount",
      `type=bind,source=${authFile},target=/run/secrets/auth_secret,readonly`,
      "-e",
      "AUTH_SECRET_FILE=/run/secrets/auth_secret",
      "--mount",
      `type=volume,source=${credentialVolume},target=/run/credentials,readonly`,
      "-e",
      "BRAG_CREDENTIAL_KEY_FILE=/run/credentials/key",
      "-e",
      "BRAG_ENV=local",
      "-e",
      "BRAG_PITCH_WORKER_PAUSED=1",
      "-e",
      "BRAG_PITCH_AUDIO_DIR=/var/lib/brag/pitches",
      "--tmpfs",
      "/var/lib/brag/pitches:rw,size=16m,uid=1000,gid=1000,mode=700",
      "-e",
      `APP_ORIGIN=${baseUrl}`,
      "-e",
      "DATABASE_URL_FILE=/run/secrets/database_url",
      "-p",
      `127.0.0.1:${webPort}:3200`,
      ...(suite === "github"
        ? [
            "--mount",
            `type=bind,source=${githubMock},target=/run/github-provider.mjs,readonly`,
            "--mount",
            `type=bind,source=${githubId},target=/run/github-client-id,readonly`,
            "--mount",
            `type=bind,source=${githubSecret},target=/run/github-client-secret,readonly`,
            "-e",
            "GITHUB_CLIENT_ID_FILE=/run/github-client-id",
            "-e",
            "GITHUB_CLIENT_SECRET_FILE=/run/github-client-secret",
            "-e",
            "NODE_OPTIONS=--import=/run/github-provider.mjs",
          ]
        : []),
      image,
    ]);
  } else if (needsServer) {
    server = spawn(
      process.execPath,
      [
        ...(suite === "github" ? ["--import", githubMock] : []),
        "node_modules/next/dist/bin/next",
        "start",
        "app",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(webPort),
      ],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const output of [server.stdout, server.stderr])
      output.on("data", (data) => diagnostics.push(data.toString()));
  }
  let live = !needsServer;
  for (let attempt = 0; needsServer && attempt < 60; attempt++) {
    checkInterrupted();
    if (server && server.exitCode !== null) break;
    try {
      live = (await fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(500) })).ok;
    } catch {}
    if (live) break;
    await pause(500);
  }
  if (!live) throw new Error("Test web process did not become live");
  const fixtureFile = path.join(directory, "fixture.json");
  await writeFile(
    fixtureFile,
    JSON.stringify({
      container: name,
      runtimeUrl,
      migrationUrl,
      adminUrl,
      operatorUrl: url("brag_operator", passwords.operator),
      authFile,
      credentialFile,
      migrationFile,
      baseUrl,
      ...(image ? { webContainer, network, migrationImage, migrationDockerFile } : {}),
    }),
    { mode: 0o600 },
  );
  const result = await new Promise((resolve) => {
    checkInterrupted();
    const child = spawn(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "--test", `app/tests/${suites[suite]}`],
      {
        cwd: root,
        env: { ...env, BRAG_TEST_FIXTURE_FILE: fixtureFile, BRAG_TEST_RUNTIME_FILE: runtimeFile },
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    testChild = child;
  });
  process.exitCode = result;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const suffix of ["migration", "invalid", "credentials", "proxy", "previous"])
    spawnSync("docker", ["rm", "-f", `${name}-${suffix}`], { stdio: "ignore" });
  if (image) {
    const logs = spawnSync("docker", ["logs", webContainer], { encoding: "utf8" });
    diagnostics.push(logs.stdout || "", logs.stderr || "");
    spawnSync("docker", ["rm", "-f", webContainer], { stdio: "ignore" });
  }
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), pause(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
  if (image) spawnSync("docker", ["volume", "rm", credentialVolume], { stdio: "ignore" });
  let log = diagnostics.join("");
  for (const secret of Object.values(passwords)) log = log.replaceAll(secret, "[redacted]");
  await mkdir(path.join(root, ".localfiles/runtime-evidence"), { recursive: true });
  await writeFile(path.join(root, ".localfiles/runtime-evidence", `${name}.log`), log, {
    mode: 0o600,
  });
  await rm(directory, { recursive: true, force: true });
}
