import { encodeWav } from "./audio";
export type RecordingEnd = "stop" | "limit" | "interrupted";
export async function recordPitch(
  onEnd: (audio: Blob, reason: RecordingEnd) => void,
  onError: () => void,
  onProgress: (seconds: number, paused: boolean) => void = () => {},
  sound: () => boolean = () => false,
) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let context: AudioContext | undefined,
    node: AudioWorkletNode | undefined,
    closed = false,
    paused = false,
    count = 0,
    lastSample = performance.now();
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const chunks: Float32Array[] = [];
  let reason: RecordingEnd = "limit";
  const release = () => {
    clearInterval(watchdog);
    clearTimeout(stopTimer);
    stream.getTracks().forEach((t) => t.stop());
    node?.disconnect();
    if (context) void context.close();
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    release();
    onEnd(new Blob([encodeWav(chunks, context!.sampleRate)], { type: "audio/wav" }), reason);
  };
  try {
    context = new AudioContext();
    await context.resume();
    await context.audioWorklet.addModule("/pitch-recorder.js");
    node = new AudioWorkletNode(context, "brag-pitch-recorder");
    const source = context.createMediaStreamSource(stream),
      mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    node.port.onmessage = ({ data }) => {
      if (closed) return;
      if (data.samples) {
        chunks.push(data.samples);
        lastSample = performance.now();
      }
      if (typeof data.count === "number") count = data.count;
      if (typeof data.paused === "boolean") {
        paused = data.paused;
        lastSample = performance.now();
      }
      onProgress(Math.min(30, Math.floor(count / context!.sampleRate)), paused);
      if (data.warning) {
        try {
          navigator.vibrate?.([120, 80, 120]);
        } catch {
          /* Optional device cue. */
        }
        if (sound())
          try {
            const oscillator = context!.createOscillator(),
              gain = context!.createGain();
            gain.gain.value = 0.08;
            oscillator.frequency.value = 880;
            oscillator.connect(gain);
            gain.connect(context!.destination);
            oscillator.start();
            oscillator.stop(context!.currentTime + 0.12);
          } catch {
            /* Visual countdown remains available. */
          }
      }
      if (data.done) finish();
    };
    node.onprocessorerror = () => {
      if (!closed) {
        closed = true;
        release();
        onError();
      }
    };
    // A suspended audio clock is an interruption, never a fabricated 30-second pitch.
    watchdog = setInterval(() => {
      if (!paused && performance.now() - lastSample > 5000) {
        reason = "interrupted";
        finish();
      }
    }, 1000);
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        reason = "interrupted";
        finish();
      };
    });
    return {
      pause: () => {
        if (!closed) node!.port.postMessage("pause");
      },
      resume: () => {
        if (!closed) node!.port.postMessage("resume");
      },
      stop: (why: RecordingEnd = "stop") => {
        if (closed) return;
        reason = why;
        if (why === "interrupted") finish();
        else {
          try {
            node!.port.postMessage("finish");
            stopTimer = setTimeout(() => {
              reason = "interrupted";
              finish();
            }, 1000);
          } catch {
            reason = "interrupted";
            finish();
          }
        }
      },
      discard: () => {
        closed = true;
        release();
      },
    };
  } catch (error) {
    closed = true;
    release();
    throw error;
  }
}
