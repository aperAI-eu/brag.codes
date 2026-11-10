import { createHash } from "node:crypto";
import { object, ProjectError } from "../projects/validation.ts";
import { uuid } from "../events/validation.ts";
const invalid = () => new ProjectError(400, "invalid_request");
export function moderationInput(input: unknown) {
  const v = object(input, ["action", "expected_revision", "reason"]);
  if (
    !["hide", "restore"].includes(v.action as string) ||
    !Number.isSafeInteger(v.expected_revision) ||
    Number(v.expected_revision) < 1 ||
    Number(v.expected_revision) > 2147483647 ||
    typeof v.reason !== "string" ||
    !v.reason.trim() ||
    v.reason.length > 1000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.reason)
  )
    throw invalid();
  return {
    action: v.action as "hide" | "restore",
    expected_revision: v.expected_revision as number,
    reason: v.reason.trim(),
  };
}
export function moderationParameters(input: unknown, events = false) {
  const v = object(
    input,
    events ? ["cursor", "limit"] : ["query", "visibility", "event_id", "cursor", "limit"],
  );
  const query = v.query ?? "",
    visibility = v.visibility ?? "all",
    event = v.event_id ?? null,
    limit = String(v.limit ?? "20");
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(query) ||
    !["all", "published", "hidden", "withdrawn"].includes(visibility as string) ||
    (event !== null && !uuid(event)) ||
    !/^[1-9]\d?$/.test(limit) ||
    Number(limit) > 50
  )
    throw invalid();
  const scope = createHash("sha256")
    .update(JSON.stringify([events, query.trim(), visibility, event]))
    .digest("hex");
  let cursor: string | null = null;
  if (v.cursor !== undefined) {
    try {
      if (
        typeof v.cursor !== "string" ||
        v.cursor.length > 256 ||
        !/^[A-Za-z0-9_-]+$/.test(v.cursor)
      )
        throw invalid();
      const c = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
      if (!c || Object.keys(c).sort().join(",") !== "id,scope" || c.scope !== scope || !uuid(c.id))
        throw invalid();
      cursor = c.id;
    } catch {
      throw invalid();
    }
  }
  return { query: query.trim(), visibility, event, limit: Number(limit), cursor, scope };
}
export const cursorFor = (id: string, scope: string) =>
  Buffer.from(JSON.stringify({ id, scope })).toString("base64url");
