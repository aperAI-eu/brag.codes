import { createHash } from "node:crypto";
import { runtimeConfig } from "../../../../lib/config/runtime";
import { discoveryGuide } from "../../../../gallery/instructions";
export const dynamic = "force-dynamic";
export async function GET() {
  const { origin } = await runtimeConfig();
  const body = discoveryGuide(origin);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-SHA256": createHash("sha256").update(body).digest("hex"),
    },
  });
}
