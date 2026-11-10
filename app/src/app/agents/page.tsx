import { GalleryAgentClient } from "../../gallery/agent-client";
import { runtimeConfig } from "../../lib/config/runtime";
export const dynamic = "force-dynamic";
export const metadata = { title: "For agents — brag.codes" };
export default async function Page() {
  const { origin } = await runtimeConfig();
  return <GalleryAgentClient origin={origin} />;
}
