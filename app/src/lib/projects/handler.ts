import "server-only";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import { AccessError, withUser } from "../auth/access.ts";
import { consume, mutationBody, privateHeaders } from "../auth/handler.ts";
import { intakeSlot, readAudio } from "./intake.ts";
import { MAX_AUDIO_BYTES, PITCH_POLICY } from "../../projects/model.ts";
import { projectOperations } from "./operations.ts";
import { ProjectError } from "./validation.ts";
import type { PitchConfig } from "./providers.ts";
export function projectHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
  pitchConfig: PitchConfig | null,
) {
  const ops = projectOperations(auth, db, pitchConfig, config.origin);
  return async (request: Request) => {
    const json = (body: unknown, status = 200) => {
      const payload = JSON.stringify(body);
      return new Response(payload, {
        status,
        headers: {
          ...privateHeaders,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
          ...(status === 429 ? { "Retry-After": "60" } : {}),
        },
      });
    };
    try {
      const actor = await withUser(auth, db, request.headers, async (_tx, id) => id);
      if (!(await consume(db, "projects:" + actor, 120)))
        throw new ProjectError(429, "rate_limited");
      const url = new URL(request.url),
        method = request.method,
        key = request.headers.get("idempotency-key"),
        path = url.pathname;
      const draft = path.match(/^\/api\/v1\/drafts\/([a-f0-9-]{36})(\/pitches|\/discard)?$/),
        pitch = path.match(/^\/api\/v1\/pitches\/([a-f0-9-]{36})(\/structure|\/retry)?$/);
      if (method === "GET") {
        if (path === "/api/v1/drafts")
          return json(
            await ops.forEvent(
              request.headers,
              url.searchParams.get("event_id") || "",
              url.searchParams.get("cursor"),
            ),
          );
        if (draft && !draft[2]) return json(await ops.read(request.headers, draft[1]));
        if (pitch && !pitch[2]) return json(await ops.pitch(request.headers, pitch[1]));
      }
      if (draft?.[2] === "/pitches" && method === "POST") {
        if (
          request.headers.get("origin") !== config.origin ||
          request.headers.get("sec-fetch-site") === "cross-site"
        )
          throw new AccessError(403);
        if (request.headers.get("content-type") !== "audio/wav")
          throw new ProjectError(415, "invalid_audio");
        const version = Number(request.headers.get("x-draft-version")),
          policy = request.headers.get("x-processing-policy") || "";
        await ops.preflight(request.headers, draft[1], key, version, policy);
        const release = intakeSlot(actor);
        try {
          const bytes = await readAudio(
            request,
            policy === PITCH_POLICY ? MAX_AUDIO_BYTES : 640044,
          );
          return json(
            await ops.upload(request.headers, draft[1], key, version, policy, bytes),
            202,
          );
        } finally {
          release();
        }
      }

      const body = await mutationBody(request, config.origin, 65536);
      if (draft?.[2] === "/discard" && method === "POST")
        return json(await ops.discard(request.headers, draft[1], key, body));
      if (path === "/api/v1/drafts" && method === "POST")
        return json(await ops.create(request.headers, key, body), 201);
      if (draft && !draft[2] && method === "PATCH")
        return json(await ops.save(request.headers, draft[1], key, body));
      if (pitch?.[2] === "/retry" && method === "POST")
        return json(await ops.retryRecording(request.headers, pitch[1], key, body), 202);
      if (pitch && ((pitch[2] && method === "POST") || (!pitch[2] && method === "DELETE")))
        return json(
          await ops.changePitch(request.headers, pitch[1], key, body, method === "DELETE"),
          202,
        );
      throw new ProjectError(404, "not_found");
    } catch (error) {
      const status =
        error instanceof ProjectError || error instanceof AccessError ? error.status : 503;
      const response = json(
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
        status,
      );
      if (error instanceof ProjectError && ["upload_busy", "upload_capacity"].includes(error.code))
        response.headers.set("Retry-After", "5");
      return response;
    }
  };
}
