import "server-only";
import { randomUUID } from "node:crypto";
import type { BragAuth } from "../auth/config.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import type { createDatabase } from "../database/client.ts";
import { AccessError, withUser } from "../auth/access.ts";
import { consume, mutationBody, privateHeaders } from "../auth/handler.ts";
import { EventError } from "../events/validation.ts";
import { sharingOperations } from "./operations.ts";

export const sharingPaths = [
  "/api/v1/me/share-context",
  "/api/v1/me/events",
  "/api/v1/me/projects",
];
export function sharingHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
) {
  const ops = sharingOperations(auth, db, config.origin);
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    const correlation = randomUUID();
    try {
      const url = new URL(request.url),
        path = url.pathname;
      const link = path === sharingPaths[1] && request.method === "POST";
      if (!sharingPaths.includes(path) || (request.method !== "GET" && !link))
        throw new EventError(404, "not_found");
      const owner = await withUser(auth, db, request.headers, async (_tx, id) => id);
      if (!(await consume(db, "sharing:" + owner, 120))) throw new EventError(429, "rate_limited");
      if (
        [...url.searchParams.keys()].length !== new Set(url.searchParams.keys()).size ||
        (link && url.search)
      )
        throw new EventError(400, "invalid_request");
      if (link) {
        const result = await ops.link(
          request.headers,
          request.headers.get("Idempotency-Key"),
          await mutationBody(request, config.origin, 4096),
        );
        return json(result.body, result.status);
      }
      const input = Object.fromEntries(url.searchParams);
      const result =
        path === sharingPaths[0]
          ? await ops.context(request.headers, input)
          : path === sharingPaths[1]
            ? await ops.events(request.headers, input)
            : await ops.projects(request.headers, input);
      return json(result);
    } catch (error) {
      const status =
        error instanceof EventError || error instanceof AccessError ? error.status : 503;
      const code =
        error instanceof EventError
          ? error.code
          : error instanceof AccessError
            ? {
                400: "invalid_request",
                401: "sign_in_required",
                403: "origin_denied",
                409: "conflict",
              }[error.status]
            : "temporarily_unavailable";
      // No exception/body/URL serialization: provider content and identities stay private.
      console.error(
        JSON.stringify({ operation: "sharing", outcome: code, request_id: correlation }),
      );
      return json({ error: { code, request_id: correlation } }, status);
    }
  };
}
