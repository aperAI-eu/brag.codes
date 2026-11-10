import "server-only";
import { Prisma } from "../../generated/prisma/client.ts";
import type { createDatabase } from "../database/client.ts";
import { publicProjectionFrom } from "../publication/reads.ts";
import { galleryParameters, galleryCursor, literalPattern } from "./parameters.ts";
import type { PublicProjectContent } from "../../publication/model.ts";
import type { GalleryPage, GalleryEvents } from "../../gallery/model.ts";
type Db = ReturnType<typeof createDatabase>;
const stamp = (value: Prisma.Sql) =>
  Prisma.sql`to_char(${value} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function watermark(db: Db) {
  const [row] = await db.$queryRaw<{ at: string }[]>(
    Prisma.sql`SELECT ${stamp(Prisma.sql`clock_timestamp()`)} AS at`,
  );
  return row.at;
}
export async function galleryProjects(
  db: Db,
  params: URLSearchParams,
  origin: string,
): Promise<GalleryPage> {
  const input = galleryParameters(params),
    c = input.cursor,
    snapshot = c?.snapshot ?? (await watermark(db));
  const pattern = literalPattern(input.q);
  const title = Prisma.sql`p.projection->>'title' ILIKE ${pattern}`;
  const problem = Prisma.sql`p.projection->>'problem' ILIKE ${pattern}`;
  const description = Prisma.sql`p.projection->>'description' ILIKE ${pattern}`;
  const sections = Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(p.projection->'sections') part WHERE part->>'text' ILIKE ${pattern})`;
  const rows = await db.$queryRaw<
    {
      id: string;
      event_id: string | null;
      version: number;
      published_at: string;
      projection: PublicProjectContent;
      matched: string[];
    }[]
  >(Prisma.sql`
    SELECT p.project_id AS id,p.event_id,p.version,${stamp(Prisma.sql`p.published_at`)} AS published_at,p.projection,
    ${input.q ? Prisma.sql`array_remove(ARRAY[CASE WHEN ${title} THEN 'title' END,CASE WHEN ${problem} THEN 'problem' END,CASE WHEN ${description} THEN 'description' END,CASE WHEN ${sections} THEN 'sections' END],NULL)` : Prisma.sql`ARRAY[]::text[]`} AS matched
    ${publicProjectionFrom}
    AND p.published_at<=${snapshot}::timestamptz
    ${input.event ? Prisma.sql`AND p.event_id=${input.event}::uuid` : Prisma.empty}
    ${input.q ? Prisma.sql`AND (${title} OR ${problem} OR ${description} OR ${sections})` : Prisma.empty}
    ${c ? Prisma.sql`AND (p.published_at,p.project_id)<(${c.at}::timestamptz,${c.id}::uuid)` : Prisma.empty}
    ORDER BY p.published_at DESC,p.project_id DESC LIMIT ${input.limit + 1}`);
  const last = rows[input.limit - 1];
  return {
    schema_version: 1,
    projects: rows.slice(0, input.limit).map((r) => ({
      id: r.id,
      event_id: r.event_id,
      publication_version: r.version,
      published_at: r.published_at,
      content: {
        title: r.projection.title,
        problem: r.projection.problem,
        author: { name: r.projection.author.name },
      },
      event: r.event_id ? { id: r.event_id, title: r.projection.event! } : null,
      url: `${origin}/projects/${r.id}`,
      matched_fields: r.matched,
    })),
    next_cursor:
      rows.length > input.limit
        ? galleryCursor(input.scope, last.published_at, last.id, snapshot)
        : null,
    snapshot_at: snapshot,
  };
}
export async function galleryEvents(db: Db, params: URLSearchParams): Promise<GalleryEvents> {
  const input = galleryParameters(params, true),
    c = input.cursor,
    snapshot = c?.snapshot ?? (await watermark(db));
  const rows = await db.$queryRaw<{ id: string; title: string }[]>(Prisma.sql`
    WITH visible_events AS (
      SELECT DISTINCT p.event_id AS id ${publicProjectionFrom}
      AND p.published_at<=${snapshot}::timestamptz
    ) SELECT v.id,e.title FROM visible_events v JOIN brag.event e ON e.id=v.id
    ${c ? Prisma.sql`WHERE v.id<${c.id}::uuid` : Prisma.empty}
    ORDER BY v.id DESC LIMIT ${input.limit + 1}`);
  const last = rows[input.limit - 1];
  return {
    schema_version: 1,
    events: rows.slice(0, input.limit),
    next_cursor:
      rows.length > input.limit ? galleryCursor(input.scope, snapshot, last.id, snapshot) : null,
    snapshot_at: snapshot,
  };
}
