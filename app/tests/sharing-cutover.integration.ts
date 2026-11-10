import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ownedFixture, bootstrapSchema6 } from "./fixtures/owned-migration.ts";
import { identity, event } from "./fixtures/sharing-history.ts";
import { emptyProject, LEGACY_AUTO_PITCH_POLICY } from "../src/projects/model.ts";
import { encodeWav } from "../src/projects/audio.ts";
import { credentialVault } from "../src/lib/config/vault.ts";
import { configContext } from "../src/lib/integrations/settings.ts";
const fixture = await ownedFixture();
const image = process.env.BRAG_TEST_PREVIOUS_IMAGE;
assert.match(
  image ?? "",
  /^sha256:[a-f0-9]{64}$/,
  "Supply the actual immutable schema-6 web image",
);
const admin = new pg.Client({ connectionString: fixture.adminUrl });
const name = fixture.container + "-previous";
function docker(args: string[]) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function sql(action: string) {
  const r = spawnSync(
    "python3",
    [
      "-c",
      `import importlib.util\ns=importlib.util.spec_from_file_location('m','deploy/runtime/maintenance.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.${action}_sql(6))`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0);
  return r.stdout;
}
test("actual previous schema-6 image cannot admit delayed upload or structure after maintenance fence", async () => {
  await admin.connect();
  let started = false,
    fenced = false;
  try {
    await bootstrapSchema6(fixture);
    const root = path.dirname(fixture.authFile),
      key = path.join(root, "credential-key");
    await chmod(key, 0o600);
    const owner = await identity(admin, (await readFile(fixture.authFile, "utf8")).trim()),
      e = await event(admin);
    const draft = randomUUID(),
      retryDraft = randomUUID(),
      pitch = randomUUID();
    for (const id of [draft, retryDraft])
      await admin.query(
        "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES($1,$2,$3,$4)",
        [id, owner.owner, e.id, emptyProject],
      );
    const context = {
      version: 1,
      actorId: owner.owner,
      distillOrigin: "https://distill.example.test",
      claudeModel: "claude-fixture-20261109",
      enabled: true,
    };
    const sealed = credentialVault(
      Buffer.from((await readFile(key, "utf8")).trim(), "base64"),
    ).seal(
      { distill_token: "fixture-token", anthropic_key: "fixture-key" },
      configContext(context),
    );
    await admin.query(
      "INSERT INTO brag.processor_config(version,actor_id,request_id,intent_hmac,enabled,distill_origin,claude_model,has_distill,has_claude,sealed,changed_fields) VALUES(1,$1,$2,$3,true,$4,$5,true,true,$6,'{}')",
      [
        owner.owner,
        randomUUID(),
        "f".repeat(64),
        context.distillOrigin,
        context.claudeModel,
        sealed,
      ],
    );
    await admin.query(
      "INSERT INTO brag.voice_pitch(id,draft_id,owner_id,key,media_hash,base_version,policy,status,transcript,config_version) VALUES($1,$2,$3,$4,$5,1,$6,'failed','Original received pitch',1)",
      [pitch, retryDraft, owner.owner, randomUUID(), "a".repeat(64), LEGACY_AUTO_PITCH_POLICY],
    );
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--network",
      fixture.container + "-network",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--memory",
      "384m",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "--tmpfs",
      "/tmp:size=32m,mode=1777",
      "--tmpfs",
      "/var/lib/brag/pitches:size=8m,uid=1000,gid=1000,mode=700",
      "--mount",
      `type=bind,source=${path.join(root, "runtime-docker.url")},target=/run/secrets/db,readonly`,
      "--mount",
      `type=bind,source=${fixture.authFile},target=/run/secrets/auth,readonly`,
      "--mount",
      `type=bind,source=${key},target=/run/secrets/key,readonly`,
      "-e",
      "BRAG_ENV=local",
      "-e",
      "APP_ORIGIN=" + fixture.baseUrl,
      "-e",
      "DATABASE_URL_FILE=/run/secrets/db",
      "-e",
      "AUTH_SECRET_FILE=/run/secrets/auth",
      "-e",
      "BRAG_CREDENTIAL_KEY_FILE=/run/secrets/key",
      "-e",
      "BRAG_PITCH_AUDIO_DIR=/var/lib/brag/pitches",
      "-p",
      "127.0.0.1::3200",
      image!,
    ]);
    started = true;
    const port = Number(docker(["port", name, "3200/tcp"]).split(":").at(-1));
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health/ready`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const wav = Buffer.from(encodeWav([new Float32Array(16000)], 16000));
    const delayed = (route: string, body: Buffer, type: string) => {
      let req: http.ClientRequest;
      const result = new Promise<number>((resolve, reject) => {
        req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: route,
            method: "POST",
            headers: {
              Cookie: owner.cookie,
              Origin: fixture.baseUrl,
              "Content-Type": type,
              "Content-Length": body.length,
              "Idempotency-Key": randomUUID(),
              "X-Draft-Version": "1",
              "X-Processing-Policy": LEGACY_AUTO_PITCH_POLICY,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        req.on("error", reject);
        req.write(body.subarray(0, 1));
      });
      return { result, finish: () => req!.end(body.subarray(1)) };
    };
    const upload = delayed(`/api/v1/drafts/${draft}/pitches`, wav, "audio/wav"),
      retry = delayed(
        `/api/v1/pitches/${pitch}/structure`,
        Buffer.from(JSON.stringify({ transcript: "Corrected pitch" })),
        "application/json",
      );
    await new Promise((r) => setTimeout(r, 150));
    await admin.query(sql("install"));
    fenced = true;
    upload.finish();
    retry.finish();
    const results = await Promise.all([upload.result, retry.result]);
    assert.ok(
      results.every((status) => status >= 400),
      JSON.stringify(results),
    );
    assert.equal(
      (
        await admin.query("SELECT count(*)::int AS n FROM brag.voice_pitch WHERE draft_id=$1", [
          draft,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await admin.query("SELECT status FROM brag.voice_pitch WHERE id=$1", [pitch])).rows[0]
        .status,
      "failed",
    );
    const running = docker(["inspect", "--format", "{{.State.Running}}", name]);
    assert.equal(running, "true", "Old worker stays running while admissions are fenced");
  } finally {
    if (started) docker(["rm", "-f", name]);
    if (fenced) await admin.query(sql("remove"));
    await admin.end();
  }
});
