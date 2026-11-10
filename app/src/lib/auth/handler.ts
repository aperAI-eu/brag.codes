import "server-only";
import type { BragAuth } from "./config.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import type { createDatabase } from "../database/client.ts";
import { AccessError, currentAccount, withAdmin } from "./access.ts";
import { AuthFailure, authDiagnostic, authCallbackDiagnostic } from "./diagnostics.ts";

export const returnRoutes = [
  "/",
  "/scan",
  "/share",
  "/submit",
  "/my/events",
  "/my/projects",
  "/account",
  "/admin",
  "/admin/integrations",
  "/admin/moderation",
] as const;
export function safeReturn(value: unknown): string {
  return typeof value === "string" &&
    ((returnRoutes as readonly string[]).includes(value) ||
      /^\/submit\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value) ||
      /^\/my\/projects\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:\/publish)?$/.test(
        value,
      ) ||
      /^\/events\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/submit(?:\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?$/.test(
        value,
      ))
    ? value
    : "/";
}
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: privateHeaders });
export async function mutationBody(
  request: Request,
  origin: string,
  limit = 4096,
  allowMissingOrigin = false,
): Promise<Record<string, unknown>> {
  if (
    (request.headers.get("origin") !== origin &&
      !(allowMissingOrigin && !request.headers.has("origin"))) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AccessError(403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AccessError(400);
  const reader = request.body?.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AccessError(400);
      }
      text += decoder.decode(value, { stream: true });
    }
  try {
    const data = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new AccessError(400);
  }
}

export async function consume(db: ReturnType<typeof createDatabase>, key: string, max: number) {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO brag.auth_throttle(key, "window", count) VALUES (${key}, date_trunc('minute', now()), 1)
    ON CONFLICT (key) DO UPDATE SET "window" = date_trunc('minute', now()), count =
      CASE WHEN auth_throttle."window" = date_trunc('minute', now()) THEN auth_throttle.count + 1 ELSE 1 END
    RETURNING count`;
  return rows[0].count <= max;
}

/** Public transport deliberately exposes only qualified adapter operations. */
export function identityHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const provider =
      /^\/api\/(?:v1\/auth\/providers\/(google|github)\/start|auth\/callback\/(google|github))$/
        .exec(path)
        ?.slice(1)
        .find(Boolean);
    const configured =
      provider === "google" ? !!config.google : provider === "github" ? !!config.github : false;
    const callback =
      !!provider && path === `/api/auth/callback/${provider}` && request.method === "GET";
    try {
      if (request.method === "GET" && path === "/api/v1/auth/providers")
        return json({
          providers: ["google", "microsoft", "github", "email"].map((id) => ({
            id,
            enabled: (id === "google" && !!config.google) || (id === "github" && !!config.github),
          })),
        });
      if (request.method === "GET" && path === "/api/v1/session")
        return json({ account: await currentAccount(auth, db, request.headers) });
      if (request.method === "GET" && path === "/api/v1/admin/access")
        return json(await withAdmin(auth, db, request.headers, async () => ({ allowed: true })));
      const start =
        !!provider &&
        request.method === "POST" &&
        path === `/api/v1/auth/providers/${provider}/start`;
      const signOut = request.method === "POST" && path === "/api/v1/auth/sign-out";
      if (!start && !signOut && !callback) return json({ error: "not_found" }, 404);
      let body: Record<string, unknown> = {};
      if (!callback) {
        const input = await mutationBody(request, config.origin);
        if (
          Object.keys(input).some((key) => !(start ? ["intent", "return_to"] : []).includes(key)) ||
          (start && input.intent !== undefined && input.intent !== "sign_in")
        )
          throw new AccessError(400);
        if (start) {
          if (!configured) return json({ error: "provider_unavailable" }, 503);
          body = {
            provider,
            callbackURL: config.origin + safeReturn(input.return_to),
            errorCallbackURL:
              config.origin +
              "/sign-in?return_to=" +
              encodeURIComponent(safeReturn(input.return_to)),
            disableRedirect: true,
          };
        }
      }
      if (callback) {
        const query = new URL(request.url).searchParams;
        if (
          !configured ||
          request.url.length > 8192 ||
          [...new Set(query.keys())].some((key) => query.getAll(key).length !== 1)
        )
          throw new AccessError(400);
      }
      if (
        !(await consume(
          db,
          start ? "start" : callback ? "callback" : "sign-out",
          start ? 100 : 300,
        ))
      )
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { ...privateHeaders, "Content-Type": "application/json", "Retry-After": "60" },
        });
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      // Do not accept forwarding hints or arbitrary adapter options from clients.
      for (const name of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "forwarded"])
        headers.delete(name);
      const url = callback
        ? config.origin + path + new URL(request.url).search
        : config.origin + "/api/auth/" + (start ? "sign-in/social" : "sign-out");
      const response = await auth.handler(
        new Request(url, {
          method: callback ? "GET" : "POST",
          headers,
          ...(callback ? {} : { body: JSON.stringify(body) }),
        }),
      );
      const outputHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(privateHeaders)) outputHeaders.set(key, value);
      if (callback) {
        const location = new URL(
          outputHeaders.get("location") || "/sign-in?auth=failed",
          config.origin,
        );
        const success =
          location.origin === config.origin &&
          !location.search &&
          !location.hash &&
          safeReturn(location.pathname) === location.pathname;
        const upstream = location.searchParams.get("error");
        if (!success) authCallbackDiagnostic(upstream);
        const error =
          upstream === "account_not_linked"
            ? "link_required"
            : upstream === "access_denied"
              ? "cancelled"
              : provider === "github" && upstream === "email_not_found"
                ? "email_required"
                : "failed";
        const returnTo = safeReturn(location.searchParams.get("return_to"));
        outputHeaders.set(
          "location",
          config.origin +
            (success
              ? location.pathname
              : `/sign-in?auth=${error}` +
                (returnTo === "/" ? "" : `&return_to=${encodeURIComponent(returnTo)}`)),
        );
        return new Response(null, { status: 303, headers: outputHeaders });
      }
      if (response.status >= 400)
        return json({ error: "authentication_failed" }, response.status === 429 ? 429 : 400);
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    } catch (error) {
      if (callback) {
        authDiagnostic(error instanceof AuthFailure ? error.category : "callback_unexpected");
        return new Response(null, {
          status: 303,
          headers: { ...privateHeaders, Location: config.origin + "/sign-in?auth=failed" },
        });
      }
      return json(
        { error: error instanceof AccessError ? "access_unavailable" : "temporarily_unavailable" },
        error instanceof AccessError ? error.status : 503,
      );
    }
  };
}
