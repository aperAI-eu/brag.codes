import { createHash } from "node:crypto";
import { ProjectError } from "../projects/validation.ts";
import { uuid } from "../events/validation.ts";
type Cursor = { scope: string; at: string; id: string; snapshot: string };
export type GalleryParameters = {
  q: string;
  event: string | null;
  limit: number;
  scope: string;
  cursor: Cursor | null;
};
const invalid = () => new ProjectError(400, "invalid_request");
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 23) === v.slice(0, 23);
export function galleryParameters(params: URLSearchParams, events = false): GalleryParameters {
  const allowed = events ? ["limit", "cursor"] : ["q", "event_id", "limit", "cursor"];
  if ([...params.keys()].some((k) => !allowed.includes(k) || params.getAll(k).length !== 1))
    throw invalid();
  const q = (params.get("q") ?? "").trim(),
    event = params.get("event_id");
  if (
    Array.from(q).length > 2000 ||
    /[\u0000-\u001f\u007f]/.test(q) ||
    (event !== null && !uuid(event))
  )
    throw invalid();
  const limit = params.get("limit") ?? (events ? "50" : "20");
  if (!/^[1-9]\d?$/.test(limit) || Number(limit) > 50) throw invalid();
  const scope = createHash("sha256")
    .update(JSON.stringify([events ? "events" : "projects", q, event]))
    .digest("hex");
  let cursor: Cursor | null = null;
  const raw = params.get("cursor");
  if (raw !== null) {
    try {
      if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
      const v = JSON.parse(Buffer.from(raw, "base64url").toString());
      if (
        !v ||
        Object.keys(v).sort().join(",") !== "at,id,scope,snapshot" ||
        v.scope !== scope ||
        !uuid(v.id) ||
        !timestamp(v.at) ||
        !timestamp(v.snapshot) ||
        v.at > v.snapshot
      )
        throw invalid();
      cursor = v;
    } catch {
      throw new ProjectError(400, "invalid_cursor");
    }
  }
  return { q, event, limit: Number(limit), scope, cursor };
}
export function galleryCursor(scope: string, at: string, id: string, snapshot: string) {
  return Buffer.from(JSON.stringify({ scope, at, id, snapshot })).toString("base64url");
}
export const literalPattern = (q: string) => "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
