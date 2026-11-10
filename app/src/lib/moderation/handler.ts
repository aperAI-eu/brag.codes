import "server-only";
import { randomUUID } from "node:crypto";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import { AccessError, withAdmin } from "../auth/access.ts";
import { consume, mutationBody, privateHeaders } from "../auth/handler.ts";
import { ProjectError } from "../projects/validation.ts";
import { moderationOperations } from "./operations.ts";
export const moderationPath = (path: string) =>
  path.startsWith("/api/v1/admin/moderation") ||
  /^\/api\/v1\/projects\/[^/]+\/moderation$/.test(path);
export function moderationHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
) {
  const ops = moderationOperations(auth, db);
  return async (request: Request) => {
    const json = (data: unknown, status = 200) =>
      Response.json(data, {
        status,
        headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    try {
      const u = new URL(request.url),
        p = u.pathname,
        get = request.method === "GET";
      const list = get && p === "/api/v1/admin/moderation/projects",
        events = get && p === "/api/v1/admin/moderation/events";
      const detail = get && p.match(/^\/api\/v1\/admin\/moderation\/projects\/([^/]+)$/);
      const receipt = get && p.match(/^\/api\/v1\/admin\/moderation\/receipts\/([^/]+)$/);
      const mutation =
        request.method === "POST" && p.match(/^\/api\/v1\/projects\/([^/]+)\/moderation$/);
      if (!list && !events && !detail && !receipt && !mutation)
        throw new ProjectError(404, "not_found");
      const actor = await withAdmin(auth, db, request.headers, async (_tx, id) => id);
      if (!(await consume(db, "moderation:" + actor, 120)))
        throw new ProjectError(429, "rate_limited");
      if (
        [...u.searchParams.keys()].some((k) => u.searchParams.getAll(k).length !== 1) ||
        (!list && !events && u.search)
      )
        throw new ProjectError(400, "invalid_request");
      if (list) return json(await ops.list(request.headers, Object.fromEntries(u.searchParams)));
      if (events)
        return json(await ops.events(request.headers, Object.fromEntries(u.searchParams)));
      if (detail) return json(await ops.detail(request.headers, detail[1]));
      if (receipt) return json(await ops.receipt(request.headers, receipt[1]));
      if (!mutation) throw new ProjectError(404, "not_found");
      return json(
        await ops.mutate(
          request.headers,
          mutation[1],
          request.headers.get("idempotency-key"),
          await mutationBody(request, config.origin, 8192),
        ),
      );
    } catch (e) {
      const status = e instanceof ProjectError || e instanceof AccessError ? e.status : 503;
      const code =
        e instanceof ProjectError
          ? e.code
          : e instanceof AccessError
            ? "access_unavailable"
            : "temporarily_unavailable";
      return json({ error: { code, request_id: randomUUID() } }, status);
    }
  };
}
