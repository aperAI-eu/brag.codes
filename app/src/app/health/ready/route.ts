import { database } from "../../../lib/database/client";
import { healthResponse, isDatabaseReady } from "../../../lib/runtime/health";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    return healthResponse(await isDatabaseReady(await database()));
  } catch {
    return healthResponse(false);
  }
}
