import "server-only";
import { Prisma } from "../../generated/prisma/client.ts";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withAdmin } from "../auth/access.ts";
import { ProjectError } from "../projects/validation.ts";
import { uuid } from "../events/validation.ts";
import { literalPattern } from "../gallery/parameters.ts";
import { moderationInput, moderationParameters, cursorFor } from "./validation.ts";
import type { ModerationProject, ModerationReceipt } from "../../moderation/model.ts";

type Tx = Prisma.TransactionClient;
const projection = Prisma.sql`SELECT s.project_id AS id,s.event_id,p.projection AS content,p.version,s.revision,
 s.visibility='hidden' AS hidden,s.owner_withdrawn AS withdrawn
 FROM brag.project_public_state s JOIN brag.project_publication p ON p.id=s.publication_id
 JOIN brag.project_draft d ON d.id=s.project_id WHERE d.deleted_at IS NULL AND d.discarded_at IS NULL`;
async function detail(tx: Tx, id: string): Promise<ModerationProject> {
  if (!uuid(id)) throw new ProjectError(400, "invalid_request");
  const [p] = await tx.$queryRaw<ModerationProject[]>(
    Prisma.sql`${projection} AND s.project_id=${id}::uuid`,
  );
  if (!p) throw new ProjectError(404, "project_unavailable");
  const history = await tx.$queryRaw<
    { id: string; action: string; actor: string; at: Date; reason: string }[]
  >`
    SELECT id,action,actor_name AS actor,created_at AS at,reason FROM brag.moderation_audit
    WHERE project_id=${id}::uuid ORDER BY revision DESC LIMIT 50`;
  return {
    ...p,
    history: history.map((h) => ({
      ...h,
      action: h.action === "hide" ? "Hidden" : "Restored",
      at: h.at.toISOString(),
    })),
  };
}
export function moderationOperations(auth: BragAuth, db: ReturnType<typeof createDatabase>) {
  return {
    list(headers: Headers, input: unknown) {
      return withAdmin(auth, db, headers, async (tx) => {
        const v = moderationParameters(input),
          pattern = literalPattern(v.query);
        const rows = await tx.$queryRaw<ModerationProject[]>(Prisma.sql`${projection}
       ${v.event ? Prisma.sql`AND s.event_id=${v.event}::uuid` : Prisma.empty}
       ${v.visibility === "hidden" ? Prisma.sql`AND s.visibility='hidden'` : v.visibility === "withdrawn" ? Prisma.sql`AND s.owner_withdrawn` : v.visibility === "published" ? Prisma.sql`AND s.visibility='published' AND NOT s.owner_withdrawn` : Prisma.empty}
       ${v.query ? Prisma.sql`AND (p.projection->>'title' ILIKE ${pattern} OR p.projection->>'description' ILIKE ${pattern} OR p.projection#>>'{author,name}' ILIKE ${pattern})` : Prisma.empty}
       ${v.cursor ? Prisma.sql`AND s.project_id<${v.cursor}::uuid` : Prisma.empty}
       ORDER BY s.project_id DESC LIMIT ${v.limit + 1}`);
        return {
          projects: rows.slice(0, v.limit).map((p) => ({ ...p, history: [] })),
          next_cursor: rows.length > v.limit ? cursorFor(rows[v.limit - 1].id, v.scope) : null,
        };
      });
    },
    events(headers: Headers, input: unknown) {
      return withAdmin(auth, db, headers, async (tx) => {
        const v = moderationParameters(input, true);
        const rows = await tx.$queryRaw<
          { id: string; title: string }[]
        >(Prisma.sql`SELECT e.id,e.title FROM brag.event e
       WHERE EXISTS(SELECT 1 FROM brag.project_public_state s WHERE s.event_id=e.id)
       ${v.cursor ? Prisma.sql`AND e.id<${v.cursor}::uuid` : Prisma.empty} ORDER BY e.id DESC LIMIT ${v.limit + 1}`);
        return {
          events: rows.slice(0, v.limit),
          next_cursor: rows.length > v.limit ? cursorFor(rows[v.limit - 1].id, v.scope) : null,
        };
      });
    },
    detail(headers: Headers, id: string) {
      return withAdmin(auth, db, headers, (tx) => detail(tx, id));
    },
    receipt(headers: Headers, key: string) {
      return withAdmin(auth, db, headers, async (tx, actor) => {
        if (!uuid(key)) throw new ProjectError(400, "invalid_request");
        const [r] = await tx.$queryRaw<
          { result: ModerationReceipt }[]
        >`SELECT result FROM brag.moderation_receipt WHERE actor_id=${actor} AND key=${key}::uuid`;
        if (!r) throw new ProjectError(404, "receipt_unavailable");
        return r.result;
      });
    },
    mutate(headers: Headers, id: string, key: string | null, input: unknown) {
      return withAdmin(auth, db, headers, async (tx, actor) => {
        if (!uuid(id) || !uuid(key)) throw new ProjectError(400, "invalid_request");
        const v = moderationInput(input);
        try {
          const [r] = await tx.$queryRaw<
            { result: ModerationReceipt }[]
          >`SELECT brag.moderate_project(${id}::uuid,${actor},${key}::uuid,${v.action},${v.expected_revision}::integer,${v.reason}) AS result`;
          return r.result;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
            const message = String(error.meta?.message ?? "") + " " + error.message;
            const codes = {
              access_unavailable: 403,
              invalid_request: 400,
              idempotency_conflict: 409,
              project_unavailable: 404,
              version_conflict: 409,
              rate_limited: 429,
            };
            for (const [code, status] of Object.entries(codes))
              if (message.includes(code)) throw new ProjectError(status, code);
          }
          throw error;
        }
      });
    },
  };
}
