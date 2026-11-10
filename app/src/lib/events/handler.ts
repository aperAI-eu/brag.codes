import "server-only";
import { randomUUID } from "node:crypto";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import { AccessError, withAdmin } from "../auth/access.ts";
import { mutationBody, privateHeaders, consume } from "../auth/handler.ts";
import { eventOperations, resolveEvent } from "./operations.ts";
import { EventError } from "./validation.ts";
import type { MetadataLoader } from "./metadata-fetch.ts";
export function eventHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
  metadataLoader?: MetadataLoader,
) {
  const operations = eventOperations(auth, db, config.origin, metadataLoader);
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    try {
      const url = new URL(request.url),
        path = url.pathname,
        method = request.method;
      const publicRead = path === "/api/v1/events/resolve" && method === "POST";
      if (publicRead) {
        if (!(await consume(db, "event-resolution", 300)))
          throw new EventError(429, "rate_limited");
        return json(
          await resolveEvent(
            db,
            config.origin,
            await mutationBody(request, config.origin, 4096, true),
          ),
        );
      }
      const list = path === "/api/v1/admin/events" && method === "GET";
      const detail = path.match(/^\/api\/v1\/admin\/events\/([a-f0-9-]{36})$/);
      const preview = path === "/api/v1/admin/event-candidates/preview" && method === "POST";
      const whitelist = path === "/api/v1/admin/events/whitelist" && method === "POST";
      const edit = path.match(/^\/api\/v1\/events\/([a-f0-9-]{36})$/);
      const lifecycle = path.match(
        /^\/api\/v1\/events\/([a-f0-9-]{36})\/(approve|suspend|close|reopen|source-aliases)$/,
      );
      const alias = path.match(
        /^\/api\/v1\/events\/([a-f0-9-]{36})\/source-aliases\/([a-f0-9-]{36})(\/approve)?$/,
      );
      const action = whitelist
        ? "whitelist"
        : edit && method === "PATCH"
          ? "edit"
          : lifecycle && method === "POST"
            ? lifecycle[2] === "source-aliases"
              ? "add_alias"
              : lifecycle[2]
            : alias && ((method === "DELETE" && !alias[3]) || (method === "POST" && alias[3]))
              ? alias[3]
                ? "approve_alias"
                : "remove_alias"
              : null;
      if (!list && !(detail && method === "GET") && !preview && !action)
        throw new EventError(404, "not_found");
      // Authenticate before consuming a per-user budget; each operation checks again at commit.
      const actor = await withAdmin(auth, db, request.headers, async (_tx, actorId) => actorId);
      if (!(await consume(db, "events:" + actor, 120))) throw new EventError(429, "rate_limited");
      if (list) {
        if ([...url.searchParams.keys()].length !== new Set(url.searchParams.keys()).size)
          throw new EventError(400, "invalid_request");
        return json(await operations.list(request.headers, Object.fromEntries(url.searchParams)));
      }
      if (detail && method === "GET")
        return json({ event: await operations.detail(request.headers, detail[1]) });
      const body = await mutationBody(request, config.origin, preview ? 4096 : 32768);
      if (preview) return json(await operations.preview(request.headers, body));
      if (alias) {
        if (body.alias_id !== undefined) throw new EventError(400, "invalid_request");
        body.alias_id = alias[2];
      }
      const result = await operations.mutate(
        request.headers,
        action!,
        edit?.[1] || lifecycle?.[1] || alias?.[1] || null,
        request.headers.get("idempotency-key"),
        body,
      );
      return json(result.body, result.status);
    } catch (error) {
      const status =
        error instanceof AccessError || error instanceof EventError ? error.status : 503;
      const code =
        error instanceof EventError
          ? error.code
          : error instanceof AccessError
            ? error.status === 400
              ? "invalid_request"
              : "access_unavailable"
            : "temporarily_unavailable";
      const messages: Record<string, string> = {
        invalid_request: "Check the request format.",
        unsupported_event_url: "Use a supported public event URL without ticket or tracking data.",
        event_unavailable: "This event is unavailable.",
        not_found: "This route is unavailable.",
        access_unavailable: "Sign in with current admin access to continue.",
        rate_limited: "Too many requests. Retry in one minute.",
        temporarily_unavailable: "The service is temporarily unavailable.",
        invalid_event: "Check the event fields.",
        version_conflict: "Reload and review the current event version.",
        existing_event: "This link already belongs to an event. Review it before continuing.",
        alias_conflict: "This link is already reserved. Review the existing mapping.",
        alias_limit: "This event has reached its source-link limit.",
        idempotency_conflict: "This request key was used for a different change.",
        idempotency_key_required: "Supply a UUID Idempotency-Key.",
      };
      return json(
        {
          error: {
            code,
            message: messages[code] || "The request could not be completed.",
            request_id: randomUUID(),
            ...(error instanceof EventError && error.fields ? { fields: error.fields } : {}),
          },
        },
        status,
      );
    }
  };
}
