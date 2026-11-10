import "server-only";
import { Prisma } from "../../generated/prisma/client.ts";
import { EventError } from "../events/validation.ts";
import { decodeCursor, encodeCursor, filters, type Scope } from "./validation.ts";
import { linkedEvents, moment, projectJson, projectProjection } from "./projection.ts";

type Tx = Prisma.TransactionClient;
export type EventSummary = {
  id: string;
  title: string;
  starts_at: string;
  timezone: string;
  submissions_open_at: string;
  submissions_close_at: string;
  submission_state: "scheduled" | "open" | "closed" | "suspended";
  eligible: boolean;
  canonical_url: string;
};
export type ReviewSummary = {
  state: "reserved" | "pending_review" | "confirmed" | "legacy";
  attention: "processing" | "review" | null;
  content_pending: boolean;
  confirmed_version: number | null;
  confirmed_at: string | null;
  legacy_record: boolean;
};
export type ProjectSummary = {
  published: boolean;
  has_publication: boolean;
  publication_state: "published" | "withdrawn" | "hidden" | null;
  id: string;
  event: EventSummary | null;
  title: string;
  created_at: string;
  updated_at: string;
  version: number;
  review: ReviewSummary;
  pitch: { id: string; status: string; attempt: number; recovery: string | null } | null;
};
export type LinkedEvent = EventSummary & { linked_at: string; origin: string };
export async function context(tx: Tx, owner: string, origin: string) {
  const [result] = await tx.$queryRaw<
    {
      as_of: Date;
      linked_event_count: number;
      eligible_event_count: number;
      single_eligible_event: EventSummary | null;
      project_count: number;
      unfinished_count: number;
    }[]
  >(Prisma.sql`WITH ${moment}, ${linkedEvents(owner, origin)}, ${projectProjection(owner)}
    SELECT m.as_of, (SELECT count(*)::int FROM linked) AS linked_event_count,
      (SELECT count(*)::int FROM linked WHERE eligible) AS eligible_event_count,
      CASE WHEN (SELECT count(*) FROM linked WHERE eligible)=1
        THEN (SELECT event FROM linked WHERE eligible LIMIT 1) ELSE NULL END AS single_eligible_event,
      (SELECT count(*)::int FROM projects WHERE saved) AS project_count,
      (SELECT count(*)::int FROM projects WHERE unfinished) AS unfinished_count FROM moment m`);
  return { ...result, as_of: result.as_of.toISOString() };
}
type Page<T> = { as_of: Date; cursor_valid: boolean; rows: T[] };
function page<T extends { id: string }>(result: Page<T>, owner: string, scope: Scope) {
  if (!result.cursor_valid) throw new EventError(400, "invalid_request");
  return {
    as_of: result.as_of.toISOString(),
    rows: result.rows.slice(0, 50),
    next_cursor: result.rows.length > 50 ? encodeCursor(owner, scope, result.rows[49].id) : null,
  };
}
export async function events(tx: Tx, owner: string, origin: string, input: unknown) {
  const f = filters(input, "events"),
    scope: Scope = { kind: "events", state: f.state, event_id: null };
  const cursor = decodeCursor(f.cursor, owner, scope);
  const [result] = await tx.$queryRaw<Page<LinkedEvent>[]>(Prisma.sql`
    WITH ${moment}, ${linkedEvents(owner, origin)},
    scoped AS (SELECT * FROM linked ${f.state === "eligible" ? Prisma.sql`WHERE eligible` : Prisma.empty}),
    anchor AS (SELECT * FROM scoped WHERE id=${cursor}::uuid),
    page AS (SELECT * FROM scoped WHERE ${cursor}::uuid IS NULL
      OR (linked_at,id)<(SELECT linked_at,id FROM anchor) ORDER BY linked_at DESC,id DESC LIMIT 51)
    SELECT m.as_of, (${cursor}::uuid IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS cursor_valid,
      COALESCE((SELECT jsonb_agg(event || jsonb_build_object('linked_at',linked_at,'origin',origin)
        ORDER BY linked_at DESC,id DESC) FROM page),'[]'::jsonb) AS rows FROM moment m`);
  const { rows, ...rest } = page(result, owner, scope);
  return { ...rest, events: rows };
}
export async function projects(tx: Tx, owner: string, origin: string, input: unknown) {
  const f = filters(input, "projects"),
    scope: Scope = { kind: "projects", state: f.state, event_id: f.event_id };
  const cursor = decodeCursor(f.cursor, owner, scope);
  const predicate =
    f.state === "saved"
      ? Prisma.sql`saved`
      : f.state === "unfinished"
        ? Prisma.sql`unfinished`
        : Prisma.sql`true`;
  const [result] = await tx.$queryRaw<Page<ProjectSummary>[]>(Prisma.sql`
    WITH ${moment}, ${linkedEvents(owner, origin)}, ${projectProjection(owner, f.event_id)},
    scoped AS (SELECT * FROM projects WHERE ${predicate}),
    anchor AS (SELECT * FROM scoped WHERE id=${cursor}::uuid),
    page AS (SELECT * FROM scoped WHERE ${cursor}::uuid IS NULL
      OR (created_at,id)<(SELECT created_at,id FROM anchor) ORDER BY created_at DESC,id DESC LIMIT 51)
    SELECT m.as_of, (${cursor}::uuid IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS cursor_valid,
      COALESCE((SELECT jsonb_agg(${projectJson} ORDER BY p.created_at DESC,p.id DESC)
        FROM page p LEFT JOIN linked l ON l.id=p.event_id),'[]'::jsonb) AS rows FROM moment m`);
  const { rows, ...rest } = page(result, owner, scope);
  return { ...rest, projects: rows };
}
