import "server-only";
import { Prisma } from "../../generated/prisma/client.ts";
import type { createDatabase } from "../database/client.ts";
import type {
  PublicProject,
  PublicProjectContent,
  PublicProjectSummary,
} from "../../publication/model.ts";
import { uuid } from "../events/validation.ts";
import { ProjectError } from "../projects/validation.ts";

type Db = ReturnType<typeof createDatabase>;
type Row = {
  id: string;
  event_id: string | null;
  version: number;
  projection: PublicProjectContent;
  published_at: string;
};
const stamp = Prisma.sql`to_char(p.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const columns = Prisma.sql`p.project_id AS id,p.event_id,p.version,p.projection,${stamp} AS published_at`;
export const publicProjectionFrom = Prisma.sql`FROM brag.project_public_state s JOIN brag.project_publication p ON p.id=s.publication_id
 WHERE s.visibility='published' AND NOT s.owner_withdrawn AND (s.event_id IS NULL OR EXISTS(SELECT 1 FROM brag.event_appearance a WHERE a.project_id=s.project_id AND a.event_id=s.event_id))`;
const visible = publicProjectionFrom;
const view = (r: Row): PublicProject => ({
  id: r.id,
  event_id: r.event_id,
  publication_version: r.version,
  published_at: r.published_at,
  content: r.projection,
});
export async function publicProject(db: Db, id: string) {
  if (!uuid(id)) throw new ProjectError(404, "project_unavailable");
  const [row] = await db.$queryRaw<Row[]>(
    Prisma.sql`SELECT ${columns} ${visible} AND s.project_id=${id}::uuid`,
  );
  if (!row) throw new ProjectError(404, "project_unavailable");
  return view(row);
}
type Cursor = { event: string; at: string; id: string; watermark: string };
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 23) === v.slice(0, 23);
function cursor(value: string | null, event: string): Cursor | null {
  if (value === null) return null;
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const v = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !v ||
      Object.keys(v).sort().join(",") !== "at,event,id,watermark" ||
      v.event !== event ||
      !uuid(v.id) ||
      !date(v.at) ||
      !date(v.watermark) ||
      v.at > v.watermark
    )
      throw new Error();
    return v;
  } catch {
    throw new ProjectError(400, "invalid_cursor");
  }
}
export async function publicEventProjects(
  db: Db,
  id: string,
  params: URLSearchParams = new URLSearchParams(),
) {
  if (!uuid(id)) throw new ProjectError(404, "event_unavailable");
  if (
    [...params.keys()].some(
      (k) => !["cursor", "limit"].includes(k) || params.getAll(k).length !== 1,
    )
  )
    throw new ProjectError(400, "invalid_request");
  const limitText = params.get("limit") ?? "20";
  if (!/^[1-9]\d?$/.test(limitText) || Number(limitText) > 50)
    throw new ProjectError(400, "invalid_request");
  const limit = Number(limitText),
    c = cursor(params.get("cursor"), id);
  // A suspended event's existing publications remain readable; no draft or identity joins.
  const [event] = await db.$queryRaw<
    { id: string; title: string }[]
  >`SELECT id,title FROM brag.event WHERE id=${id}::uuid AND (approval='approved' OR EXISTS(SELECT 1 FROM brag.project_public_state WHERE event_id=${id}::uuid AND visibility='published' AND NOT owner_withdrawn))`;
  if (!event) throw new ProjectError(404, "event_unavailable");
  const [time] = await db.$queryRaw<
    { at: string }[]
  >`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`;
  const watermark = c?.watermark ?? time.at;
  const rows = await db.$queryRaw<
    Row[]
  >(Prisma.sql`SELECT ${columns} ${visible} AND s.event_id=${id}::uuid
    AND p.published_at<=${watermark}::timestamptz ${c ? Prisma.sql`AND (p.published_at,p.project_id)<(${c.at}::timestamptz,${c.id}::uuid)` : Prisma.empty}
    ORDER BY p.published_at DESC,p.project_id DESC LIMIT ${limit + 1}`);
  const last = rows[limit - 1];
  return {
    event,
    projects: rows.slice(0, limit).map((r): PublicProjectSummary => ({
      ...view(r),
      content: {
        title: r.projection.title,
        problem: r.projection.problem,
        author: { name: r.projection.author.name },
      },
    })),
    next_cursor:
      rows.length > limit
        ? Buffer.from(
            JSON.stringify({ event: id, at: last.published_at, id: last.id, watermark }),
          ).toString("base64url")
        : null,
  };
}
