import http2 from "node:http2";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

// Credentials arrive on stdin, never argv/logs. TLS validation is always on for TEST.
const config = JSON.parse(readFileSync(0, "utf8"));
const local = new URL(config.origin).hostname === "127.0.0.1";
assert.ok(local || config.origin === "https://example.invalid");
const client = http2.connect(config.origin, { rejectUnauthorized: !local });
const requests = new Set();
let connectionError;
client.on("error", (error) => {
  connectionError = error;
});
function upload(account, knownLength = true) {
  const start = performance.now();
  const stream = client.request(
    {
      ":method": "POST",
      ":path": "/api/v1/drafts/" + account.draft + "/pitches",
      cookie: account.cookie,
      origin: config.requestOrigin,
      "content-type": "audio/wav",
      ...(knownLength ? { "content-length": "960044" } : {}),
      "idempotency-key": randomUUID(),
      "x-capture-contract": "share-work-v1",
      "x-draft-version": "1",
      "x-processing-policy": "pitch-30s-pause-auto-distill-claude-v3",
    },
    { endStream: false },
  );
  requests.add(stream);
  const result = new Promise((resolve, reject) => {
    let status,
      body = "";
    const timer = setTimeout(() => {
      reject(new Error("HTTP/2 upload deadline"));
      stream.close();
    }, 70000);
    stream.on("response", (headers) => {
      status = headers[":status"];
    });
    stream.on("data", (data) => {
      body += data;
      if (body.length > 131072) stream.close();
    });
    stream.on("error", reject);
    stream.on("close", () => {
      clearTimeout(timer);
      requests.delete(stream);
    });
    stream.on("end", () => {
      clearTimeout(timer);
      try {
        resolve({
          status,
          code: JSON.parse(body).error?.code,
          elapsedMs: Math.round(performance.now() - start),
        });
      } catch {
        reject(
          new Error(
            "HTTP/2 bounded response missing: status=" +
              status +
              " bytes=" +
              body.length +
              " reset=" +
              stream.rstCode,
          ),
        );
      }
    });
  });
  // Intentional stalled uploads are cancelled during cleanup.
  result.catch(() => {});
  return { stream, result };
}
try {
  const stalls = [upload(config.accounts[0]), upload(config.accounts[0])];
  let cap;
  try {
    await new Promise((r) => setTimeout(r, 750));
    cap = await upload(config.accounts[0]).result.catch((e) => {
      throw new Error("cap: " + e.message);
    });
    assert.equal(cap.status, 429);
    assert.equal(cap.code, "upload_busy");
  } finally {
    stalls.forEach(({ stream }) => stream.close(http2.constants.NGHTTP2_CANCEL));
  }
  await new Promise((r) => setTimeout(r, 500));
  const [timeout, unknownLength] = await Promise.all([
    upload(config.accounts[4]).result.catch((e) => {
      throw new Error("known-length timeout: " + e.message);
    }),
    upload(config.accounts[4], false).result.catch((e) => {
      throw new Error("unknown-length timeout: " + e.message);
    }),
  ]);
  for (const result of [timeout, unknownLength]) {
    assert.equal(result.status, 408);
    assert.equal(result.code, "upload_timeout");
    assert.ok(result.elapsedMs >= 59000 && result.elapsedMs < 69000);
  }
  assert.equal(connectionError, undefined);
  console.log(JSON.stringify({ protocol: "h2", cap, zeroByte: timeout, unknownLength }));
} finally {
  for (const stream of requests) stream.close(http2.constants.NGHTTP2_CANCEL);
  client.destroy();
}
