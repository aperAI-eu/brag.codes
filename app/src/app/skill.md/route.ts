import { runtimeConfig } from "../../lib/config/runtime";
import { agentSkill } from "../../projects/agent-skill";
export const dynamic = "force-dynamic";
export async function GET() {
  const { origin } = await runtimeConfig();
  return new Response(agentSkill.replaceAll("{origin}", origin), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
