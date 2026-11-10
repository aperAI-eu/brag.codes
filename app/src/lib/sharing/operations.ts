import "server-only";
import { createHash } from "node:crypto";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withUser } from "../auth/access.ts";
import { EventError, normalizeSource, object, uuid } from "../events/validation.ts";
import { context, events, projects, type EventSummary } from "./queries.ts";
import { linkedEvents, moment } from "./projection.ts";
import { Prisma } from "../../generated/prisma/client.ts";

export function sharingOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  origin: string,
) {
  return {
    context(headers: Headers, input: unknown = {}) {
      return withUser(auth, db, headers, async (tx, owner) => {
        object(input, []);
        return context(tx, owner, origin);
      });
    },
    events(headers: Headers, input: unknown = {}) {
      return withUser(auth, db, headers, (tx, owner) => events(tx, owner, origin, input));
    },
    projects(headers: Headers, input: unknown = {}) {
      return withUser(auth, db, headers, (tx, owner) => projects(tx, owner, origin, input));
    },
    link(headers: Headers, key: unknown, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(key)) throw new EventError(400, "idempotency_key_required");
        const data = object(input, ["url", "entry_method"]);
        if (
          typeof data.entry_method !== "string" ||
          !["qr_scan", "pasted_url", "direct_event"].includes(data.entry_method)
        )
          throw new EventError(400, "invalid_request");
        const source = normalizeSource(data.url, origin);
        if (data.entry_method === "direct_event" && !source.eventId)
          throw new EventError(400, "invalid_request");
        const intentHash = createHash("sha256")
          .update(JSON.stringify([source.key, data.entry_method]))
          .digest("hex");
        let receipt = await tx.authorEventMutation.findUnique({
          where: { actorId_key: { actorId: owner, key } },
        });
        if (receipt && receipt.intentHash !== intentHash)
          throw new EventError(409, "idempotency_conflict");
        if (!receipt) {
          // Resolve only stored approved aliases. Take event before alias locks, matching admin writers.
          const alias = source.eventId
            ? null
            : await tx.eventSourceAlias.findUnique({ where: { sourceKey: source.key } });
          const eventId = source.eventId ?? alias?.eventId;
          if (!eventId) throw new EventError(404, "event_unavailable");
          const approved = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM brag.event WHERE id=${eventId}::uuid AND approval='approved' FOR SHARE`;
          if (!approved.length) throw new EventError(404, "event_unavailable");
          if (!source.eventId) {
            const active = await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM brag.event_source_alias WHERE source_key=${source.key}
                AND event_id=${eventId}::uuid AND state='approved' FOR SHARE`;
            if (!active.length) throw new EventError(404, "event_unavailable");
          }
          const existing = await tx.authorEvent.findUnique({
            where: { ownerId_eventId: { ownerId: owner, eventId } },
          });
          if (!existing)
            await tx.authorEvent.create({
              data: { ownerId: owner, eventId, origin: data.entry_method },
            });
          receipt = await tx.authorEventMutation.create({
            data: {
              actorId: owner,
              key,
              intentHash,
              eventId,
              outcome: existing ? "already_linked" : "created",
            },
          });
        }
        // Replay retains the committed outcome while reflecting current private eligibility,
        // including a subsequently removed alias or suspended event.
        const [row] = await tx.$queryRaw<
          { id: string; linked_at: Date; origin: string; event: EventSummary }[]
        >(Prisma.sql`
          WITH ${moment}, ${linkedEvents(owner, origin)} SELECT id,linked_at,origin,event FROM linked
          WHERE id=${receipt.eventId}::uuid`);
        if (!row) throw new EventError(404, "event_unavailable");
        const already = receipt.outcome === "already_linked";
        return {
          status: already ? 200 : 201,
          body: {
            link: { event_id: row.id, linked_at: row.linked_at.toISOString(), origin: row.origin },
            already_linked: already,
            event: row.event,
            receipt: receipt.key,
          },
        };
      });
    },
  };
}
