import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeSlot, readAudio } from "../src/lib/projects/intake.ts";
test("upload slots enforce account and process caps, release exactly once and are reusable", () => {
  const release = [intakeSlot("one"), intakeSlot("one")];
  try {
    assert.throws(() => intakeSlot("one"), /upload_busy/);
    for (let n = 0; n < 6; n++) release.push(intakeSlot("user" + n));
    assert.throws(() => intakeSlot("overflow"), /upload_capacity/);
    release[0]();
    release[0]();
    release.push(intakeSlot("replacement"));
  } finally {
    release.forEach((r) => r());
  }
  const next = intakeSlot("one");
  next();
});
test("zero-byte stalls return upload_timeout at 60 seconds; disconnect and size limits release readers without destroying timeout responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled++;
    },
  });
  const request = new Request("https://brag.example/upload", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  const pending = assert.rejects(readAudio(request, 960044), (e: unknown) => {
    assert.equal((e as { status: number }).status, 408);
    return /upload_timeout/.test(String(e));
  });
  t.mock.timers.tick(60000);
  await pending;
  assert.equal(cancelled, 0);
  assert.equal(stream.locked, false);
  const abort = new AbortController();
  const disconnected = readAudio(
    new Request("https://brag.example/upload", {
      method: "POST",
      body: new ReadableStream(),
      signal: abort.signal,
      duplex: "half",
    } as RequestInit),
    960044,
  );
  const check = assert.rejects(disconnected, /upload_aborted/);
  abort.abort();
  await check;
  await assert.rejects(
    readAudio(
      new Request("https://brag.example/upload", { method: "POST", body: new Uint8Array(960045) }),
      960044,
    ),
    /pitch_too_long/,
  );
});
