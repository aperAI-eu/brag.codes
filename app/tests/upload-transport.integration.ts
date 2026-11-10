import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { spawnSync, spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { credentialVault } from "../src/lib/config/vault.ts";
import { configContext } from "../src/lib/integrations/settings.ts";
import { identity, association } from "./fixtures/sharing-history.ts";
import { emptyProject, PITCH_POLICY } from "../src/projects/model.ts";
import { encodeWav } from "../src/projects/audio.ts";
const proxyImage =
  "traefik:v3.7.17@sha256:e15b8921020b4fd81de5746b170dfceec221d2450711449f6427e4692881511a";
async function port() {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const p = (server.address() as net.AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return p;
}
export async function uploadTransportChecks(
  t: TestContext,
  fixture: { container: string; baseUrl: string; authFile: string },
  admin: pg.Client,
  eventId: string,
  http2Only = false,
) {
  const root = path.dirname(fixture.authFile),
    directory = path.join(root, "proxy-transport");
  await mkdir(directory, { mode: 0o755 });
  const proxyPort = await port(),
    http2Port = await port(),
    webPort = await port(),
    healthPort = await port();
  let config = await readFile("deploy/runtime/traefik.runtime.yml", "utf8");
  config = config
    .replace('address: "127.0.0.1:8082"', `address: "127.0.0.1:${healthPort}"`)
    .replace('address: ":8080"', `address: "127.0.0.1:${webPort}"`)
    .replace('address: ":8443"', `address: "127.0.0.1:${proxyPort}"`);
  const secureEntry = config.slice(config.indexOf("  websecure:"), config.indexOf("providers:"));
  config = config.replace(
    "entryPoints:\n",
    () =>
      "entryPoints:\n" +
      secureEntry
        .replace("websecure:", "webh2:")
        .replace(`127.0.0.1:${proxyPort}`, `127.0.0.1:${http2Port}`),
  );
  await writeFile(path.join(directory, "traefik.yml"), config, { mode: 0o444 });
  let routes = (await readFile("deploy/runtime/routes.test.yml", "utf8"))
    .replaceAll("Host(`example.invalid`)", "Host(`127.0.0.1`)")
    .replaceAll("      tls:\n        certResolver: letsencrypt\n", "")
    .replace("http://brag-runtime:3200", fixture.baseUrl);
  routes = routes.replace("sniStrict: true", "sniStrict: false").replace(
    "  routers:\n",
    () => `  routers:
    pitch-h2:
      rule: Host(\`127.0.0.1\`) && PathRegexp(\`^/api/v1/drafts/[a-f0-9-]{36}/pitches$\`) && Method(\`POST\`)
      priority: 200
      entryPoints: [webh2]
      service: runtime
      middlewares: [upload-duplex]
      tls: {}
`,
  );
  await writeFile(path.join(directory, "routes.yml"), routes, { mode: 0o444 });
  const name = fixture.container + "-proxy";
  let started = false;
  const owners: string[] = [];
  const secret = (await readFile(fixture.authFile, "utf8")).trim(),
    vault = credentialVault(
      Buffer.from((await readFile(path.join(root, "credential-key"), "utf8")).trim(), "base64"),
    );
  const accounts = [] as { cookie: string; draft: string; owner: string }[];
  try {
    for (let n = 0; n < 5; n++) {
      const a = await identity(admin, secret);
      owners.push(a.owner);
      await association(admin, a.owner, eventId);
      const id = randomUUID();
      await admin.query(
        "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ($1,$2,$3,$4)",
        [id, a.owner, eventId, emptyProject],
      );
      accounts.push({ cookie: a.cookie, draft: id, owner: a.owner });
    }
    const settings = {
      version: 999,
      actorId: accounts[0].owner,
      distillOrigin: "https://distill.example.test",
      claudeModel: "claude-fixture-20261109",
      enabled: true,
    };
    await admin.query(
      "INSERT INTO brag.processor_config(version,actor_id,distill_origin,claude_model,enabled,sealed,request_id,intent_hmac,has_distill,has_claude,changed_fields) VALUES ($1,$2,$3,$4,true,$5,$6,$7,true,true,ARRAY['distill_token','anthropic_key'])",
      [
        settings.version,
        settings.actorId,
        settings.distillOrigin,
        settings.claudeModel,
        vault.seal(
          { distill_token: "fixture-distill-token", anthropic_key: "fixture-anthropic-key" },
          configContext(settings),
        ),
        randomUUID(),
        "f".repeat(64),
      ],
    );
    const run = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "host",
        "--read-only",
        "--user",
        "65532:65532",
        "--cap-drop",
        "ALL",
        "--memory",
        "192m",
        "--cpus",
        "0.5",
        "--pids-limit",
        "64",
        "--tmpfs",
        "/acme:rw,size=1m",
        "--mount",
        `type=bind,source=${path.join(directory, "traefik.yml")},target=/etc/traefik/traefik.yml,readonly`,
        "--mount",
        `type=bind,source=${path.join(directory, "routes.yml")},target=/etc/traefik/routes.yml,readonly`,
        "--mount",
        `type=bind,source=${path.resolve("deploy/runtime/upload-duplex")},target=/plugins-local/src/github.com/aperAI-eu/brag.codes/uploadduplex,readonly`,
        proxyImage,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    started = true;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${healthPort}/ping`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const wav = Buffer.from(encodeWav([new Float32Array(16000 * 30).fill(0.1)], 16000));
    const intake = (a: (typeof accounts)[number], body: Buffer | null, rate = 0) => {
      const startedAt = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let request: http.ClientRequest;
      let rejectResult: (error: Error) => void = () => {};
      let deadline: ReturnType<typeof setTimeout>;
      const result = new Promise<{
        status: number;
        code?: string;
        elapsed: number;
        pitch?: string;
      }>((resolve, reject) => {
        rejectResult = reject;
        deadline = setTimeout(() => {
          request.destroy();
          reject(new Error("Proxy total upload deadline exceeded"));
        }, 70000);
        request = http.request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            path: `/api/v1/drafts/${a.draft}/pitches`,
            method: "POST",
            headers: {
              Cookie: a.cookie,
              Origin: fixture.baseUrl,
              "Content-Type": "audio/wav",
              "Transfer-Encoding": "chunked",
              "Idempotency-Key": randomUUID(),
              "X-Capture-Contract": "share-work-v1",
              "X-Draft-Version": "1",
              "X-Processing-Policy": PITCH_POLICY,
            },
          },
          (response) => {
            clearTimeout(timer);
            response.on("error", reject);
            let text = "";
            response.on("aborted", () =>
              reject(
                new Error(
                  `Proxy response aborted: status=${response.statusCode}, bytes=${Buffer.byteLength(text)}, contentLength=${response.headers["content-length"]}, transferEncoding=${response.headers["transfer-encoding"]}`,
                ),
              ),
            );
            response.on("data", (chunk) => {
              text += chunk;
            });
            response.on("end", () => {
              try {
                const data = JSON.parse(text);
                resolve({
                  status: response.statusCode!,
                  code: data.error?.code,
                  elapsed: performance.now() - startedAt,
                  pitch: data.pitch?.id,
                });
              } catch {
                reject(new Error("Proxy did not return the bounded application response"));
              }
            });
          },
        );
        request.on("error", reject);
        request.setTimeout(70000, () =>
          request.destroy(new Error("Proxy upload deadline exceeded")),
        );
        request.flushHeaders();
        if (body) {
          let offset = 0;
          const send = () => {
            if (request.destroyed) return;
            const size = rate ? Math.floor(rate / 8 / 10) : body.length;
            request.write(body.subarray(offset, offset + size));
            offset += size;
            if (offset >= body.length) request.end();
            else timer = setTimeout(send, 100);
          };
          send();
        }
      });
      return {
        result: result.finally(() => clearTimeout(deadline)),
        abort: () => {
          clearTimeout(timer);
          request!.destroy();
          rejectResult(new Error("Synthetic disconnect"));
        },
      };
    };
    if (http2Only) {
      const result = await runProbe(
        "node",
        ["--input-type=module", "-e", await readFile("deploy/runtime/transport-http2.mjs", "utf8")],
        {
          encoding: "utf8",
          timeout: 80000,
          input: JSON.stringify({
            origin: `https://127.0.0.1:${http2Port}`,
            requestOrigin: fixture.baseUrl,
            accounts,
          }),
        },
      );
      assert.equal(result.status, 0, result.stderr);
      await writeFile(
        `.localfiles/runtime-evidence/${fixture.container}-http2.json`,
        result.stdout,
      );
      return;
    }
    await t.test(
      "draft acknowledgement p95 stays below 500ms at 20 concurrent owned clients",
      async () => {
        const clients = [] as { cookie: string; draft: string }[];
        for (let n = 0; n < 20; n++) {
          const a = await identity(admin, secret);
          owners.push(a.owner);
          await association(admin, a.owner, eventId);
          const id = randomUUID();
          await admin.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ($1,$2,$3,$4)",
            [id, a.owner, eventId, emptyProject],
          );
          clients.push({ cookie: a.cookie, draft: id });
        }
        const samples: number[] = [];
        for (let round = 1; round <= 5; round++)
          await Promise.all(
            clients.map(async (a) => {
              const begin = performance.now();
              const response = await fetch(fixture.baseUrl + `/api/v1/drafts/${a.draft}`, {
                method: "PATCH",
                headers: {
                  Cookie: a.cookie,
                  Origin: fixture.baseUrl,
                  "Content-Type": "application/json",
                  "X-Capture-Contract": "share-work-v1",
                  "Idempotency-Key": randomUUID(),
                },
                body: JSON.stringify({
                  expected_version: round,
                  fields: { ...emptyProject, title: "Load fixture " + round },
                  review_source: { method: "typed" },
                }),
              });
              const data = await response.json();
              samples.push(performance.now() - begin);
              assert.equal(response.status, 200);
              assert.equal(data.draft.version, round + 1);
            }),
          );
        const ordered = [...samples].sort((a, b) => a - b),
          p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
        await writeFile(
          `.localfiles/runtime-evidence/${fixture.container}-draft-load.json`,
          JSON.stringify(
            {
              clients: 20,
              rounds: 5,
              budgetMs: 500,
              p95,
              samples,
              scope: "owned loopback HTTP; not a venue or public-region measurement",
            },
            null,
            2,
          ),
        );
        assert.ok(p95 < 500, `Draft p95 ${p95.toFixed(1)}ms exceeds the 500ms pilot budget`);
      },
    );
    await t.test(
      "pinned proxy admits full 30-second WAV at 256/512/1000 kbit/s without truncation",
      async () => {
        const results = await Promise.all(
          [256000, 512000, 1000000].map((rate, i) => intake(accounts[i], wav, rate).result),
        );
        results.forEach((r, i) => {
          assert.equal(r.status, 202, JSON.stringify(r));
          assert.ok(r.elapsed >= ((wav.length * 8) / [256000, 512000, 1000000][i]) * 1000 - 1200);
        });
        await writeFile(
          `.localfiles/runtime-evidence/${fixture.container}-upload-shaping.json`,
          JSON.stringify(
            { proxyImage, bytes: wav.length, rates: [256000, 512000, 1000000], results },
            null,
            2,
          ),
        );
        await admin.query("DELETE FROM brag.voice_pitch WHERE owner_id=ANY($1)", [owners]);
      },
    );
    await t.test(
      "HTTP account/process cap-plus-one stalls reject, disconnects release slots, and zero-byte timeout is an app 408",
      async () => {
        const stalls = accounts.slice(0, 4).flatMap((a) => [intake(a, null), intake(a, null)]);
        const completed = stalls.map((s) => s.result.catch(() => null));
        try {
          await new Promise((r) => setTimeout(r, 500));
          const denials = await Promise.all(
            Array.from({ length: 20 }, () => intake(accounts[0], null).result),
          );
          denials.forEach((denial) => {
            assert.equal(denial.status, 429);
            assert.equal(denial.code, "upload_busy");
          });
          const account = denials[0];
          assert.equal(account.status, 429);
          assert.equal(account.code, "upload_busy");
          const process = await intake(accounts[4], null).result;
          assert.equal(process.status, 503);
          assert.equal(process.code, "upload_capacity");
        } finally {
          stalls.forEach((s) => s.abort());
          await Promise.all(completed);
        }
        await new Promise((r) => setTimeout(r, 250));
        const zeroes = await Promise.all(
          accounts.slice(0, 4).flatMap((a) => [intake(a, null).result, intake(a, null).result]),
        );
        zeroes.forEach((result) => {
          assert.equal(result.status, 408);
          assert.equal(result.code, "upload_timeout");
          assert.ok(result.elapsed >= 59000 && result.elapsed < 69000, JSON.stringify(result));
        });
        const zero = zeroes[0];
        assert.equal(zero.status, 408);
        assert.equal(zero.code, "upload_timeout");
        assert.ok(zero.elapsed >= 59000 && zero.elapsed < 69000, JSON.stringify(zero));
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM brag.voice_pitch WHERE owner_id=ANY($1)",
              [owners],
            )
          ).rows[0].n,
          0,
        );
        const reused = await intake(accounts[4], wav).result;
        assert.equal(reused.status, 202);
        await writeFile(
          `.localfiles/runtime-evidence/${fixture.container}-upload-stall.json`,
          JSON.stringify({ proxyImage, zero, zeroes, reused }, null, 2),
        );
      },
    );
    await t.test(
      "packaged public smoke helper exercises owned intake and cleans only synthetic records",
      async () => {
        const result = await runProbe(
          "python3",
          [
            "-c",
            `import importlib.util,json,http.client,pathlib,sys,subprocess
spec=importlib.util.spec_from_file_location('m','deploy/runtime/transport-smoke.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
f=json.load(open(sys.argv[1]));m.DB=f['container'];m.ORIGIN=f['baseUrl'];m.AUTH_FILE=pathlib.Path(f['authFile']);m.COOKIE_PREFIX='brag.session_token='
m.connect=lambda:http.client.HTTPConnection('127.0.0.1',int(sys.argv[2]),timeout=70)
def http2_probe(accounts):
 p=subprocess.run(['node','--input-type=module','-e',pathlib.Path('deploy/runtime/transport-http2.mjs').read_text()],input=json.dumps({'origin':'https://127.0.0.1:'+sys.argv[3],'requestOrigin':f['baseUrl'],'accounts':accounts}),text=True,capture_output=True,timeout=80)
 assert p.returncode==0,p.stderr
 return json.loads(p.stdout)
m.http2_probe=http2_probe
if f.get('webContainer'):m.WEB=f['webContainer']
else:
 m.paused=lambda:None
 def cleanup(ids):
  for id in ids:
   assert str(__import__('uuid').UUID(id))==id
   (pathlib.Path(f['authFile']).parent/'http-pitches'/(id+'.wav')).unlink(missing_ok=True)
 m.cleanup_audio=cleanup
print(json.dumps(m.smoke()))
`,
            process.env.BRAG_TEST_FIXTURE_FILE!,
            String(proxyPort),
            String(http2Port),
          ],
          { encoding: "utf8", timeout: 230000 },
        );
        assert.equal(result.status, 0, result.stderr);
        const evidence = JSON.parse(result.stdout);
        assert.equal(evidence.zeroByte.status, 408);
        await writeFile(
          `.localfiles/runtime-evidence/${fixture.container}-packaged-smoke.json`,
          JSON.stringify(evidence, null, 2),
        );
      },
    );
  } finally {
    if (started) {
      const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
      await writeFile(
        `.localfiles/runtime-evidence/${fixture.container}-proxy.log`,
        logs.stdout + logs.stderr,
      );
      spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    }
    if (owners.length) {
      await admin.query("DELETE FROM brag.voice_pitch WHERE owner_id=ANY($1)", [owners]);
      await admin.query(
        "DELETE FROM brag.processor_config WHERE version=999 AND actor_id=ANY($1)",
        [owners],
      );
      await admin.query("DELETE FROM brag.draft_mutation WHERE actor_id=ANY($1)", [owners]);
      await admin.query("DELETE FROM brag.project_admission WHERE owner_id=ANY($1)", [owners]);
      await admin.query("DELETE FROM brag.project_draft WHERE owner_id=ANY($1)", [owners]);
      await admin.query("DELETE FROM brag.author_event WHERE owner_id=ANY($1)", [owners]);
      await admin.query('DELETE FROM brag.auth_session WHERE "userId"=ANY($1)', [owners]);
      await admin.query("DELETE FROM brag.auth_user WHERE id=ANY($1)", [owners]);
    }
  }
}

function runProbe(
  command: string,
  args: string[],
  options: { encoding: string; timeout: number; input?: string },
) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.end(options.input);
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), options.timeout);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    },
  );
}
