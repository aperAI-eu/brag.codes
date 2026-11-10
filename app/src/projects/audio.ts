import { AUDIO_RATE, PITCH_SECONDS } from "./model.ts";
export function encodeWav(chunks: Float32Array[], sourceRate: number): ArrayBuffer {
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const count = Math.min(
    PITCH_SECONDS * AUDIO_RATE,
    Math.floor((samples.length * AUDIO_RATE) / sourceRate),
  );
  const buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_RATE, true);
  view.setUint32(28, AUDIO_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const begin = Math.floor((i * sourceRate) / AUDIO_RATE),
      end = Math.min(samples.length, Math.floor(((i + 1) * sourceRate) / AUDIO_RATE));
    let sum = 0;
    for (let j = begin; j < end; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - begin)));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return buffer;
}
