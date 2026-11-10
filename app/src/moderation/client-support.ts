export class ModerationFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function moderationRequest<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const r = await fetch("/api/v1/" + path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new ModerationFailure(r.status, data.error?.code ?? "temporarily_unavailable");
  return data;
}
export type ModerationIntent = {
  id: string;
  key: string;
  body?: { action: "hide" | "restore"; expected_revision: number; reason: string };
};
export function readPending(storage: string): ModerationIntent | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(storage) ?? "null");
    const uuid = /^[a-f0-9-]{36}$/;
    return v && uuid.test(v.id) && uuid.test(v.key) ? { id: v.id, key: v.key } : null;
  } catch {
    return null;
  }
}
export function remember(storage: string, intent: ModerationIntent | null) {
  try {
    if (intent) sessionStorage.setItem(storage, JSON.stringify({ id: intent.id, key: intent.key }));
    else sessionStorage.removeItem(storage);
  } catch {
    /* In-memory recovery remains available. */
  }
}
