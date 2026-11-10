import { moderationHandler, moderationPath } from "../../../lib/moderation/handler";
import { publicationHandler, publicationPath } from "../../../lib/publication/handler";
import { agentHandler } from "../../../lib/projects/agent";
import { sharingHandler, sharingPaths } from "../../../lib/sharing/handler";
import { projectHandler } from "../../../lib/projects/handler";
import { activePitchConfig } from "../../../lib/integrations/settings";
import { integrationHandler } from "../../../lib/integrations/handler";
import { readCredentialVault } from "../../../lib/config/vault";
import { eventHandler } from "../../../lib/events/handler";
import { authentication } from "../../../lib/auth/runtime";
import { identityHandler, privateHeaders } from "../../../lib/auth/handler";
import { runtimeConfig } from "../../../lib/config/runtime";
import { database } from "../../../lib/database/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const [auth, db, config] = await Promise.all([authentication(), database(), runtimeConfig()]);
    const path = new URL(request.url).pathname;
    if (moderationPath(path)) return moderationHandler(auth, db, config)(request);
    if (publicationPath(path)) return publicationHandler(auth, db, config)(request);
    if (sharingPaths.includes(path)) return sharingHandler(auth, db, config)(request);
    if (path.startsWith("/api/v1/admin/integrations"))
      return integrationHandler(auth, db, config, await readCredentialVault())(request);
    if (
      path.startsWith("/api/v1/agent") ||
      path.endsWith("/handoff") ||
      path.endsWith("/agent-upload") ||
      path.endsWith("/agent-proposal")
    )
      return agentHandler(auth, db, config)(request);
    if (path.startsWith("/api/v1/drafts") || path.startsWith("/api/v1/pitches"))
      return projectHandler(auth, db, config, await activePitchConfig(db))(request);
    if (
      path.startsWith("/api/v1/events") ||
      path.startsWith("/api/v1/admin/events") ||
      path === "/api/v1/admin/event-candidates/preview"
    )
      return eventHandler(auth, db, config)(request);
    return identityHandler(auth, db, config)(request);
  } catch {
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: privateHeaders },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PATCH = handle;
