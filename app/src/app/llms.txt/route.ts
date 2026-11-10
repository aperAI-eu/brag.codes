import { runtimeConfig } from "../../lib/config/runtime";
export const dynamic = "force-dynamic";
export async function GET() {
  const { origin } = await runtimeConfig();
  return new Response(
    `# brag.codes

Public Slop Gallery: ${origin}/slop
Read-only discovery guide: ${origin}/skills/discovery/v1.md
Human-readable agent entry: ${origin}/agents
Public project list/search: ${origin}/api/v1/projects
Public event choices: ${origin}/api/v1/gallery/events
Public detail: ${origin}/api/v1/projects/{id}

Anonymous public reads need no token. Never send private source or secrets in queries.
Submission is separate: ${origin}/skill.md
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
