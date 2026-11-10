import "server-only";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import type { CredentialVault } from "../config/vault.ts";
import { withAdmin, AccessError } from "../auth/access.ts";
import { mutationBody, privateHeaders, consume } from "../auth/handler.ts";
import { integrationOperations, SettingsError } from "./settings.ts";
export function integrationHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
  vault: CredentialVault | null,
) {
  const ops = integrationOperations(auth, db, vault);
  return async (request: Request) => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    try {
      const actor = await withAdmin(auth, db, request.headers, async (_tx, id) => id);
      if (!(await consume(db, "integrations:" + actor, 30)))
        throw new SettingsError(429, "rate_limited");
      if (new URL(request.url).pathname !== "/api/v1/admin/integrations")
        throw new SettingsError(404, "not_found");
      if (request.method === "GET") return json(await ops.read(request.headers));
      if (request.method !== "POST") throw new SettingsError(405, "method_not_allowed");
      const input = await mutationBody(request, config.origin, 24576);
      return json(await ops.save(request.headers, request.headers.get("idempotency-key"), input));
    } catch (error) {
      return json(
        {
          error: {
            code:
              error instanceof SettingsError
                ? error.code
                : error instanceof AccessError
                  ? "access_unavailable"
                  : "credential_storage_unavailable",
          },
        },
        error instanceof SettingsError || error instanceof AccessError ? error.status : 503,
      );
    }
  };
}
