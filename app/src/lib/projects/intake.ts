import "server-only";
import { ProjectError } from "./validation.ts";

const accounts = new Map<string, number>();
let active = 0;
export function intakeSlot(owner: string) {
  if ((accounts.get(owner) ?? 0) >= 2) throw new ProjectError(429, "upload_busy");
  if (active >= 8) throw new ProjectError(503, "upload_capacity");
  accounts.set(owner, (accounts.get(owner) ?? 0) + 1);
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    const count = (accounts.get(owner) ?? 1) - 1;
    if (count) accounts.set(owner, count);
    else accounts.delete(owner);
  };
}
export async function readAudio(request: Request, limit: number) {
  if (request.signal.aborted) throw new ProjectError(400, "upload_aborted");
  const reader = request.body?.getReader();
  if (!reader) throw new ProjectError(400, "invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let fail: (error: ProjectError) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const abort = () => fail(new ProjectError(400, "upload_aborted"));
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => fail(new ProjectError(408, "upload_timeout")), 60000);
  try {
    if (request.signal.aborted) abort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ProjectError(413, "pitch_too_long");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    // Cancelling a still-connected request can destroy Next's HTTP socket before
    // its 408/413 response is written (notably behind HTTP/2 proxies). Stop reads
    // and release the lock; the server/proxy closes the body after the response.
    if (request.signal.aborted) void reader.cancel().catch(() => undefined);
    if (error instanceof ProjectError) throw error;
    throw new ProjectError(400, "upload_aborted");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
