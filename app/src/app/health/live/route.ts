import { healthResponse } from "../../../lib/runtime/health";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET() {
  return healthResponse(true);
}
