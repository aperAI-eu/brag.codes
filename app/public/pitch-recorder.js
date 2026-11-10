// Capture time is counted in samples in the audio thread, never wall time.
class PitchRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.count = 0;
    this.finished = false;
    this.paused = false;
    this.warned = false;
    this.port.onmessage = ({ data }) => {
      if (data === "finish") this.finish();
      else if (data === "pause" || data === "resume") {
        this.paused = data === "pause";
        this.port.postMessage({ paused: this.paused, count: this.count });
      }
    };
  }
  finish() {
    if (!this.finished) {
      this.finished = true;
      this.port.postMessage({ done: true, count: this.count });
    }
  }
  process(inputs) {
    if (this.finished) return false;
    if (this.paused) return true;
    const channel = inputs[0]?.[0];
    if (channel) {
      const data = channel.slice(
        0,
        Math.max(0, Math.min(channel.length, 30 * sampleRate - this.count)),
      );
      this.count += data.length;
      if (data.length) this.port.postMessage({ samples: data, count: this.count }, [data.buffer]);
      if (!this.warned && this.count >= 25 * sampleRate) {
        this.warned = true;
        this.port.postMessage({ warning: true });
      }
      if (this.count >= 30 * sampleRate) this.finish();
    }
    return !this.finished;
  }
}
registerProcessor("brag-pitch-recorder", PitchRecorder);
