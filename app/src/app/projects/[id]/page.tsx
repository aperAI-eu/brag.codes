import { GalleryDetailClient } from "../../../gallery/detail-client";
import { notFound } from "next/navigation";
import { database } from "../../../lib/database/client";
import { publicProject } from "../../../lib/publication/reads";
import { ProjectError } from "../../../lib/projects/validation";
import { PublicProjectPageView } from "../../../ui/publication";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  try {
    const project = await publicProject(await database(), id);
    if ((await searchParams).from === "slop") return <GalleryDetailClient project={project} />;
    return (
      <main className="access-main">
        <PublicProjectPageView
          content={project.content}
          eventUrl={project.event_id ? "/events/" + project.event_id : null}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof ProjectError && error.status === 404) notFound();
    throw error;
  }
}
