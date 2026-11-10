import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { recordPitch } from "../src/projects/recorder.ts";

test("worklet pauses captured samples, emits one 25-second cue and caps native rates at 30 seconds", async () => {
  const script = await readFile("app/public/pitch-recorder.js", "utf8");
  for (const rate of [16000, 44100, 48000]) {
    let Recorder: new () => {
      port: { onmessage: ({ data }: { data: string }) => void };
      process: (inputs: Float32Array[][]) => boolean;
    };
    const messages: {
      samples?: Float32Array;
      count?: number;
      warning?: boolean;
      done?: boolean;
      paused?: boolean;
    }[] = [];
    class Base {
      port = {
        onmessage: null,
        postMessage: (data: (typeof messages)[number]) => messages.push(data),
      };
    }
    vm.runInNewContext(script, {
      AudioWorkletProcessor: Base,
      sampleRate: rate,
      registerProcessor: (_name: string, c: typeof Recorder) => {
        Recorder = c;
      },
    });
    const recorder = new Recorder!(),
      chunk = new Float32Array(128).fill(0.1);
    for (let i = 0; i < rate / 128; i++) recorder.process([[chunk]]);
    recorder.port.onmessage({ data: "pause" });
    const count = messages.at(-1)!.count;
    for (let i = 0; i < (rate * 10) / 128; i++) recorder.process([[chunk]]);
    assert.equal(messages.at(-1)!.count, count);
    recorder.port.onmessage({ data: "resume" });
    while (recorder.process([[chunk]])) {}
    recorder.port.onmessage({ data: "finish" });
    assert.equal(messages.filter((m) => m.done).length, 1);
    assert.equal(messages.filter((m) => m.warning).length, 1);
    assert.equal(
      messages.reduce((n, m) => n + (m.samples?.length ?? 0), 0),
      30 * rate,
    );
  }
});
test("interruption and stalled Finish release microphone and deliver only retained audio once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let stopped = 0,
    closed = 0;
  const ended: { audio: Blob; reason: string }[] = [];
  let node: Worklet;
  class Worklet {
    constructor() {
      node = this;
    }
    port = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage() {} };
    connect() {}
    disconnect() {}
    onprocessorerror = null;
  }
  class Context {
    sampleRate = 16000;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {}
    async close() {
      closed++;
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
  }
  const track = {
    stop() {
      stopped++;
    },
    onended: null,
  };
  const substitutes = {
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
      },
    },
    AudioContext: Context,
    AudioWorkletNode: Worklet,
  };
  const originals = Object.fromEntries(
    Object.keys(substitutes).map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]),
  );
  try {
    for (const [name, value] of Object.entries(substitutes))
      Object.defineProperty(globalThis, name, { configurable: true, value });
    const recording = await recordPitch(
      (audio, reason) => ended.push({ audio, reason }),
      () => assert.fail("unexpected capture error"),
    );
    node!.port.onmessage!({ data: { samples: new Float32Array(160), count: 160 } });
    recording.pause();
    recording.stop();
    t.mock.timers.tick(1001);
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    assert.equal(ended.length, 1);
    assert.equal(ended[0].reason, "interrupted");
    assert.equal(ended[0].audio.size, 364);
    recording.stop();
    node!.port.onmessage!({ data: { done: true } });
    assert.equal(ended.length, 1);
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
