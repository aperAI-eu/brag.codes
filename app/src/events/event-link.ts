import { EventError, normalizeSource, type Source } from "../lib/events/validation.ts";

/** Paste convenience only: QR payloads and API input still require explicit HTTPS. */
export function normalizePastedEventLink(value: string, origin: string): Source {
  if (value.length > 2048) throw new EventError(422, "unsupported_event_url");
  const input = value.trim();
  // Only bare host/path input gets a scheme. Keep explicit schemes, credentials,
  // ports and relative paths unchanged so the shared allowlist rejects them.
  const url = /^[a-z0-9.-]+\//i.test(input) ? `https://${input}` : input;
  return normalizeSource(url, origin);
}
