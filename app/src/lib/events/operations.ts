import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, Event } from "../../generated/prisma/client.ts";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withAdmin } from "../auth/access.ts";
import { EventError, object, uuid, normalizeSource, eventFields } from "./validation.ts";
import type { ManagedEvent } from "../../events/model.ts";
import { loadEventMetadata, type MetadataLoader } from "./metadata-fetch.ts";

type Tx = Prisma.TransactionClient;
const include = {
  aliases: { orderBy: { id: "asc" as const } },
  audit: { orderBy: { version: "desc" as const }, take: 20 },
};
type FullEvent = Prisma.EventGetPayload<{ include: typeof include }>;
export function admission(
  event: Pick<Event, "approval" | "manuallyClosed" | "opensAt" | "closesAt">,
  now: Date,
): "scheduled" | "open" | "closed" {
  if (event.approval !== "approved" || event.manuallyClosed || now >= event.closesAt)
    return "closed";
  return now < event.opensAt ? "scheduled" : "open";
}
async function clock(tx: Tx): Promise<Date> {
  return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
}
function base(event: Event, now: Date, origin: string) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    timezone: event.timezone,
    starts_at: event.startsAt.toISOString(),
    submissions_open_at: event.opensAt.toISOString(),
    submissions_close_at: event.closesAt.toISOString(),
    submission_state: admission(event, now),
    canonical_url: `${origin}/events/${event.id}`,
    submission_url: `${origin}/events/${event.id}/submit`,
  };
}
function managed(event: FullEvent, now: Date, origin: string): ManagedEvent {
  return {
    ...base(event, now, origin),
    approval: event.approval,
    manually_closed: event.manuallyClosed,
    version: event.version,
    generation: event.generation,
    aliases: event.aliases.map((alias) => ({
      id: alias.id,
      url: alias.url,
      state: alias.state,
      version: alias.version,
    })),
    audit: event.audit.map((item) => ({
      actor_id: item.actorId,
      action: item.action,
      version: item.version,
      reason: item.reason,
      created_at: item.createdAt.toISOString(),
    })),
  };
}
function canonical(input: unknown): string {
  if (Array.isArray(input)) return "[" + input.map(canonical).join(",") + "]";
  if (input && typeof input === "object")
    return (
      "{" +
      Object.entries(input)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(input);
}
async function existing(tx: Tx, id: unknown) {
  if (!uuid(id)) throw new EventError(404, "event_unavailable");
  const event = await tx.event.findUnique({ where: { id }, include });
  if (!event) throw new EventError(404, "event_unavailable");
  return event;
}
export function eventOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  origin: string,
  metadataLoader: MetadataLoader = loadEventMetadata,
) {
  return {
    async preview(headers: Headers, input: unknown) {
      const inspect = () =>
        withAdmin(auth, db, headers, async (tx) => {
          const data = object(input, ["url"]),
            source = normalizeSource(data.url, origin);
          const alias = source.eventId
            ? null
            : await tx.eventSourceAlias.findUnique({ where: { sourceKey: source.key } });
          const id = source.eventId || alias?.eventId;
          const event = id ? await existing(tx, id) : null;
          return {
            url: source.url,
            state: event ? (alias?.state === "removed" ? "removed" : event.approval) : "new",
            alias_id: alias?.id ?? null,
            alias_version: alias?.version ?? null,
            event: event ? managed(event, await clock(tx), origin) : null,
          };
        });
      const candidate = await inspect();
      if (candidate.event) return candidate;
      // Do not hold database/session locks while waiting for a provider.
      const metadata = await metadataLoader(normalizeSource(candidate.url, origin));
      // Authority may have changed, or another admin may have saved this link meanwhile.
      const current = await inspect();
      return current.event ? current : { ...current, metadata };
    },
    list(headers: Headers, input: Record<string, unknown>) {
      return withAdmin(auth, db, headers, async (tx) => {
        const data = object(input, ["query", "approval", "submission", "cursor", "limit"]);
        const { query = "", approval = "", submission = "", cursor = "" } = data;
        const limit = data.limit === undefined ? 20 : Number(data.limit);
        if (
          typeof query !== "string" ||
          query.length > 200 ||
          !["", "pending", "approved", "suspended"].includes(String(approval)) ||
          !["", "scheduled", "open", "closed"].includes(String(submission)) ||
          (cursor !== "" && !uuid(cursor)) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 50
        )
          throw new EventError(400, "invalid_request");
        const now = await clock(tx);
        const eligible: Prisma.EventWhereInput = { approval: "approved", manuallyClosed: false };
        const state: Prisma.EventWhereInput =
          submission === "open"
            ? { ...eligible, opensAt: { lte: now }, closesAt: { gt: now } }
            : submission === "scheduled"
              ? { ...eligible, opensAt: { gt: now } }
              : submission === "closed"
                ? {
                    OR: [
                      { approval: { not: "approved" } },
                      { manuallyClosed: true },
                      { closesAt: { lte: now } },
                    ],
                  }
                : {};
        const rows = await tx.event.findMany({
          where: {
            AND: [
              state,
              {
                ...(approval ? { approval: String(approval) } : {}),
                ...(cursor ? { id: { gt: String(cursor) } } : {}),
                ...(query ? { title: { contains: query, mode: "insensitive" } } : {}),
              },
            ],
          },
          orderBy: { id: "asc" },
          take: limit + 1,
          include,
        });
        return {
          events: rows.slice(0, limit).map((event) => managed(event, now, origin)),
          next_cursor: rows.length > limit ? rows[limit - 1].id : null,
        };
      });
    },
    detail(headers: Headers, id: string) {
      return withAdmin(auth, db, headers, async (tx) =>
        managed(await existing(tx, id), await clock(tx), origin),
      );
    },
    mutate(headers: Headers, action: string, id: string | null, key: unknown, input: unknown) {
      return withAdmin(auth, db, headers, async (tx, actorId) => {
        if (!uuid(key)) throw new EventError(400, "idempotency_key_required");
        const keys: Record<string, string[]> = {
          whitelist: [
            "url",
            "event",
            "event_id",
            "expected_version",
            "expected_alias_version",
            "reason",
          ],
          edit: ["event", "expected_version", "reason"],
          approve: ["expected_version", "reason"],
          suspend: ["expected_version", "reason"],
          close: ["expected_version", "reason"],
          reopen: ["expected_version", "reason"],
          add_alias: ["expected_version", "url", "reason"],
          approve_alias: ["expected_version", "expected_alias_version", "alias_id", "reason"],
          remove_alias: ["expected_version", "expected_alias_version", "alias_id", "reason"],
        };
        if (!Object.hasOwn(keys, action)) throw new EventError(400, "invalid_request");
        const data = object(input, keys[action]);
        if (typeof data.reason !== "string" || !data.reason.trim() || data.reason.length > 300)
          throw new EventError(422, "invalid_event", {
            reason: "Give a reason of 1–300 characters.",
          });
        // One short transaction serializes event/alias changes across admins in the pilot.
        // This lock also orders future publication checks against suspension/closure.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1789002)::text`;
        const intentHash = createHash("sha256")
          .update(canonical({ action, id, input: data }))
          .digest("hex");
        const receipt = await tx.eventMutation.findUnique({
          where: { actorId_key: { actorId, key } },
        });
        if (receipt) {
          if (receipt.intentHash !== intentHash) throw new EventError(409, "idempotency_conflict");
          return { status: receipt.status, body: receipt.result };
        }
        const now = await clock(tx);
        let eventId: string,
          status = 200;
        if (action === "whitelist" && !data.event_id) {
          const source = normalizeSource(data.url, origin);
          if (
            source.eventId ||
            (await tx.eventSourceAlias.findUnique({ where: { sourceKey: source.key } }))
          )
            throw new EventError(409, "existing_event");
          if (data.expected_version !== undefined || data.expected_alias_version !== undefined)
            throw new EventError(400, "invalid_request");
          eventId = randomUUID();
          await tx.event.create({
            data: {
              id: eventId,
              ...eventFields(data.event),
              approval: "approved",
              version: 1,
              generation: 1,
              updatedAt: now,
            },
          });
          await tx.eventSourceAlias.create({
            data: {
              id: randomUUID(),
              eventId,
              provider: source.provider,
              sourceKey: source.key,
              url: source.url,
              state: "approved",
              version: 1,
              approvedBy: actorId,
              approvedAt: now,
            },
          });
          status = 201;
        } else {
          const targetId = action === "whitelist" ? data.event_id : id;
          if (!uuid(targetId)) throw new EventError(404, "event_unavailable");
          // Event before alias: author linking takes the same order, so removing
          // an alias cannot deadlock against an event-link transaction.
          await tx.$queryRaw`SELECT id FROM brag.event WHERE id=${targetId}::uuid FOR UPDATE`;
          const event = await existing(tx, targetId);
          eventId = event.id;
          if (data.expected_version !== event.version)
            throw new EventError(409, "version_conflict");
          const update: Prisma.EventUpdateInput = {
            version: { increment: 1 },
            generation: { increment: 1 },
            updatedAt: now,
          };
          if (action === "edit") Object.assign(update, eventFields(data.event, event));
          if (action === "suspend") update.approval = "suspended";
          if (action === "approve" || action === "whitelist") update.approval = "approved";
          if (action === "close") update.manuallyClosed = true;
          if (action === "reopen") {
            if (event.closesAt <= now)
              throw new EventError(422, "invalid_event", {
                submissions_close_at: "Set To in the future before reopening.",
              });
            update.manuallyClosed = false;
          }
          if (action === "whitelist" || action === "add_alias") {
            const source = normalizeSource(data.url, origin);
            if (source.eventId) throw new EventError(422, "unsupported_event_url");
            const alias = await tx.eventSourceAlias.findUnique({
              where: { sourceKey: source.key },
            });
            if (alias && alias.eventId !== eventId) throw new EventError(409, "alias_conflict");
            if (action === "whitelist") {
              if (!alias || alias.version !== data.expected_alias_version)
                throw new EventError(409, "version_conflict");
              Object.assign(update, eventFields(data.event, event));
              await tx.eventSourceAlias.update({
                where: { id: alias.id },
                data: {
                  state: "approved",
                  version: { increment: 1 },
                  approvedBy: actorId,
                  approvedAt: now,
                },
              });
            } else {
              if (alias) throw new EventError(409, "alias_conflict");
              if (event.aliases.length >= 20) throw new EventError(422, "alias_limit");
              await tx.eventSourceAlias.create({
                data: {
                  id: randomUUID(),
                  eventId,
                  provider: source.provider,
                  sourceKey: source.key,
                  url: source.url,
                  state: "pending",
                  version: 1,
                },
              });
            }
          }
          if (action === "remove_alias" || action === "approve_alias") {
            const alias = event.aliases.find((a) => a.id === data.alias_id);
            if (!alias || alias.version !== data.expected_alias_version)
              throw new EventError(409, "version_conflict");
            await tx.eventSourceAlias.update({
              where: { id: alias.id },
              data: {
                state: action === "remove_alias" ? "removed" : "approved",
                version: { increment: 1 },
                ...(action === "approve_alias" ? { approvedBy: actorId, approvedAt: now } : {}),
              },
            });
          }
          await tx.event.update({ where: { id: eventId }, data: update });
        }
        const saved = await existing(tx, eventId);
        await tx.eventAudit.create({
          data: {
            id: randomUUID(),
            eventId,
            actorId,
            action,
            version: saved.version,
            reason: data.reason.trim(),
            createdAt: now,
          },
        });
        const body = { event: managed(await existing(tx, eventId), now, origin), receipt: key };
        await tx.eventMutation.create({ data: { actorId, key, intentHash, result: body, status } });
        return { status, body };
      });
    },
  };
}
export async function resolveEvent(
  db: ReturnType<typeof createDatabase>,
  origin: string,
  input: unknown,
) {
  const source = normalizeSource(object(input, ["url"]).url, origin);
  return db.$transaction(async (tx) => {
    const alias = source.eventId
      ? null
      : await tx.eventSourceAlias.findUnique({ where: { sourceKey: source.key } });
    const id = source.eventId || (alias?.state === "approved" ? alias.eventId : null);
    const event = id ? await tx.event.findUnique({ where: { id } }) : null;
    if (!event || event.approval !== "approved") throw new EventError(404, "event_unavailable");
    const result = base(event, await clock(tx), origin);
    return { event: { ...result, submissions_open: result.submission_state === "open" } };
  });
}

export async function readPublicEvent(
  db: ReturnType<typeof createDatabase>,
  origin: string,
  id: string,
) {
  if (!uuid(id)) throw new EventError(404, "event_unavailable");
  return db.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id } });
    if (!event) throw new EventError(404, "event_unavailable");
    if (event.approval !== "approved") {
      const published = await tx.$queryRaw<
        { id: string }[]
      >`SELECT project_id AS id FROM brag.project_public_state WHERE event_id=${id}::uuid AND visibility='published' LIMIT 1`;
      if (!published.length) throw new EventError(404, "event_unavailable");
    }
    const result = base(event, await clock(tx), origin);
    return { event: { ...result, submissions_open: result.submission_state === "open" } };
  });
}
