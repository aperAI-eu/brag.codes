import { createHash } from "node:crypto";
import { EventError, object, uuid } from "../events/validation.ts";

export type EventFilter = "all" | "eligible";
export type ProjectFilter = "all" | "saved" | "unfinished";
export type Scope = { kind: "events" | "projects"; state: string; event_id: string | null };
const invalid = () => new EventError(400, "invalid_request");
export function filters(input: unknown, kind: "events"): { state: EventFilter; cursor?: unknown };
export function filters(
  input: unknown,
  kind: "projects",
): {
  state: ProjectFilter;
  event_id: string | null;
  cursor?: unknown;
};
export function filters(
  input: unknown,
  kind: "events" | "projects",
): {
  state: string;
  event_id?: string | null;
  cursor?: unknown;
} {
  const data = object(
    input,
    kind === "events" ? ["state", "cursor"] : ["state", "event_id", "cursor"],
  );
  const state = data.state === undefined ? (kind === "events" ? "all" : "saved") : data.state;
  const allowed = kind === "events" ? ["all", "eligible"] : ["all", "saved", "unfinished"];
  if (
    typeof state !== "string" ||
    !allowed.includes(state) ||
    (data.event_id !== undefined && !uuid(data.event_id))
  )
    throw invalid();
  return {
    state,
    event_id: typeof data.event_id === "string" ? data.event_id.toLowerCase() : null,
    cursor: data.cursor,
  };
}
function ownerScope(owner: string, scope: Scope) {
  return createHash("sha256")
    .update(JSON.stringify([owner, scope.kind, scope.state, scope.event_id]))
    .digest("hex");
}
/** Opaque navigation, not authority: the referenced row is also checked in the scoped query. */
export function encodeCursor(owner: string, scope: Scope, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, scope: ownerScope(owner, scope), id })).toString(
    "base64url",
  );
}
export function decodeCursor(value: unknown, owner: string, scope: Scope): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw invalid();
  try {
    const data = object(JSON.parse(Buffer.from(value, "base64url").toString("utf8")), [
      "v",
      "scope",
      "id",
    ]);
    if (
      data.v !== 1 ||
      data.scope !== ownerScope(owner, scope) ||
      !uuid(data.id) ||
      encodeCursor(owner, scope, data.id) !== value
    )
      throw invalid();
    return data.id.toLowerCase();
  } catch {
    throw invalid();
  }
}
