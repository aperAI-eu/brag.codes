import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

// Real pinned proxy with a loopback-only synthetic backend. Incomplete uploads
// must receive the entire rejection even when framing changes or the body arrives
// after its headers. No application identity, storage or provider is involved.
const proxyImage =
  "traefik:v3.7.17@sha256:e15b8921020b4fd81de5746b170dfceec221d2450711449f6427e4692881511a";
const evidence = path.resolve(".localfiles/runtime-evidence");
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(path.resolve(".localfiles/proxy-response-"));
await chmod(root, 0o755);
const payload = JSON.stringify({ error: { code: "upload_timeout" } });
const backend = http.createServer((req, res) => {
  req.on("data", () => {});
  if (req.url === "/ready") {
    res.end("ready");
    return;
  }
  setTimeout(() => {
    const body = req.url === "/compressed" ? gzipSync(payload) : Buffer.from(payload);
    res.setHeader("Content-Type", "application/json");
    if (req.url !== "/chunked") res.setHeader("Content-Length", body.length);
    if (req.url === "/compressed") res.setHeader("Content-Encoding", "gzip");
    res.writeHead(408);
    res.flushHeaders();
    setTimeout(() => {
      res.write(body.subarray(0, 5));
      setTimeout(() => res.end(body.subarray(5)), 10);
    }, 10);
  }, 20);
});
await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
await writeFile(
  path.join(root, "config.yml"),
  `experimental:
  localPlugins:
    uploadduplex:
      moduleName: github.com/aperAI-eu/brag.codes/uploadduplex
log:
  level: WARN
entryPoints:
  web:
    address: '127.0.0.1:${port}'
providers:
  file:
    filename: /routes.yml
`,
);
await writeFile(
  path.join(root, "routes.yml"),
  `http:
  routers:
    test:
      rule: PathPrefix(\`/\`)
      service: test
      middlewares: [duplex]
  middlewares:
    duplex:
      plugin:
        uploadduplex: {}
  services:
    test:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:${backend.address().port}
`,
);
const name = "brag-proxy-response-" + process.pid;
const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });
let started = false;
try {
  const result = docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "host",
    "--cpus",
    "0.5",
    "--memory",
    "192m",
    "--pids-limit",
    "64",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--user",
    "65532:65532",
    "-v",
    root + "/config.yml:/etc/traefik/traefik.yml:ro",
    "-v",
    root + "/routes.yml:/routes.yml:ro",
    "-v",
    path.resolve("deploy/runtime/upload-duplex") +
      ":/plugins-local/src/github.com/aperAI-eu/brag.codes/uploadduplex:ro",
    proxyImage,
  ]);
  assert.equal(result.status, 0, result.stderr);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, {
        signal: AbortSignal.timeout(500),
      });
      await response.text();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Synthetic proxy did not start");
  for (const target of ["/length", "/chunked", "/compressed"]) {
    for (let batch = 0; batch < 25; batch++) {
      await Promise.all(
        Array.from(
          { length: 8 },
          () =>
            new Promise((resolve, reject) => {
              let body = "";
              const request = http.request(
                {
                  host: "127.0.0.1",
                  port,
                  path: target,
                  method: "POST",
                  headers: { "Transfer-Encoding": "chunked" },
                },
                (response) => {
                  response.on("data", (chunk) => {
                    body += chunk;
                  });
                  response.on("aborted", () =>
                    reject(new Error(`${target}: aborted after ${body.length} bytes`)),
                  );
                  response.on("error", reject);
                  response.on("end", () => {
                    try {
                      assert.equal(response.statusCode, 408);
                      assert.equal(body, payload, target);
                      resolve();
                    } catch (error) {
                      reject(error);
                    }
                  });
                },
              );
              request.on("error", reject);
              request.setTimeout(5000, () =>
                request.destroy(new Error(`${target}: response timeout`)),
              );
              request.flushHeaders();
            }),
        ),
      );
    }
    console.log(JSON.stringify({ framing: target.slice(1), requests: 200, completeErrors: 200 }));
  }
} finally {
  if (started) {
    const logs = docker(["logs", name]);
    await writeFile(path.join(evidence, "upload-response-proxy.log"), logs.stdout + logs.stderr);
    docker(["rm", "-f", name]);
  }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
  await rm(root, { recursive: true, force: true });
}
