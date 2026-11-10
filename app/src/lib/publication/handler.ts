import "server-only";
import { galleryProjects, galleryEvents } from "../gallery/reads.ts";
import { deletionOperations } from "../deletion/operations.ts";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import { AccessError, withUser } from "../auth/access.ts";
import { consume, mutationBody, privateHeaders } from "../auth/handler.ts";
import { ProjectError } from "../projects/validation.ts";
import { publicationOperations } from "./operations.ts";
import { publicEventProjects, publicProject } from "./reads.ts";
export const publicationPath = (path: string) =>
  path === "/api/v1/projects" ||
  path === "/api/v1/gallery/events" ||
  path.startsWith("/api/v1/projects/") ||
  /^\/api\/v1\/events\/[^/]+\/projects$/.test(path);
export function publicationHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
) {
  const ops = publicationOperations(auth, db, config.origin);
  const deletion = deletionOperations(auth, db);
  return async (request: Request) => {
    const json = (data: unknown, status = 200) =>
      Response.json(data, {
        status,
        headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    try {
      const url = new URL(request.url),
        path = url.pathname,
        method = request.method;
      const gallery = path === "/api/v1/projects",
        galleryEventList = path === "/api/v1/gallery/events";
      const project = path.match(/^\/api\/v1\/projects\/([a-f0-9-]{36})$/),
        event = path.match(/^\/api\/v1\/events\/([a-f0-9-]{36})\/projects$/);
      if (
        method === "GET" &&
        (project || event || gallery || galleryEventList) &&
        !(await consume(db, "publication-public-read", 600))
      )
        throw new ProjectError(429, "rate_limited");
      if (method === "GET" && gallery)
        return json(await galleryProjects(db, url.searchParams, config.origin));
      if (method === "GET" && galleryEventList)
        return json(await galleryEvents(db, url.searchParams));
      if (method === "GET" && project)
        return json({ project: await publicProject(db, project[1]) });
      if (method === "GET" && event)
        return json(await publicEventProjects(db, event[1], url.searchParams));
      const actor = await withUser(auth, db, request.headers, async (_tx, id) => id);
      if (!(await consume(db, "publication:" + actor, 120)))
        throw new ProjectError(429, "rate_limited");
      const deletionReceipt = path.match(
        /^\/api\/v1\/projects\/([a-f0-9-]{36})\/deletion-receipts\/([a-f0-9-]{36})$/,
      );
      if (method === "GET" && deletionReceipt)
        return json(
          await deletion.receipt(request.headers, deletionReceipt[1], deletionReceipt[2]),
        );
      if (method === "DELETE" && project) {
        const body = await mutationBody(request, config.origin, 4096);
        return json(
          await deletion.remove(
            request.headers,
            project[1],
            request.headers.get("idempotency-key"),
            body,
          ),
        );
      }
      const state = path.match(/^\/api\/v1\/projects\/([a-f0-9-]{36})\/publication-state$/);
      if (method === "GET" && state) return json(await ops.state(request.headers, state[1]));
      const withdrawal = path.match(
        /^\/api\/v1\/projects\/([a-f0-9-]{36})\/withdrawal-receipts\/([a-f0-9-]{36})$/,
      );
      if (method === "GET" && withdrawal)
        return json(await ops.withdrawalReceipt(request.headers, withdrawal[1], withdrawal[2]));
      const receipt = path.match(
        /^\/api\/v1\/projects\/([a-f0-9-]{36})\/publication-receipts\/([a-f0-9-]{36})$/,
      );
      if (method === "GET" && receipt)
        return json(await ops.receipt(request.headers, receipt[1], receipt[2]));
      const action = path.match(
        /^\/api\/v1\/projects\/([a-f0-9-]{36})\/(publication-review|publish|withdraw)$/,
      );
      if (method !== "POST" || !action) throw new ProjectError(404, "not_found");
      const body = await mutationBody(request, config.origin, 65536),
        key = request.headers.get("idempotency-key");
      return json(
        action[2] === "publication-review"
          ? await ops.prepare(request.headers, action[1], key, body)
          : action[2] === "withdraw"
            ? await ops.withdraw(request.headers, action[1], key, body)
            : await ops.publish(request.headers, action[1], key, body),
        201,
      );
    } catch (error) {
      return json(
        {
          error: {
            code:
              error instanceof ProjectError
                ? error.code
                : error instanceof AccessError
                  ? "access_unavailable"
                  : "temporarily_unavailable",
          },
        },
        error instanceof ProjectError || error instanceof AccessError ? error.status : 503,
      );
    }
  };
}
