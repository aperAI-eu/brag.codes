import { GalleryClient } from "../../gallery/client";
import { database } from "../../lib/database/client";
import { runtimeConfig } from "../../lib/config/runtime";
import { galleryProjects, galleryEvents } from "../../lib/gallery/reads";
import { consume } from "../../lib/auth/handler";
import type { GalleryState } from "../../ui/gallery";
export const dynamic = "force-dynamic";
export const metadata = { title: "Slop Gallery — brag.codes" };
export default async function Slop({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams,
    params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    for (const part of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(key, part);
  let initial = null,
    initialEvents = null,
    state: GalleryState = "ready";
  try {
    const [db, config] = await Promise.all([database(), runtimeConfig()]);
    if (!(await consume(db, "publication-public-read", 600))) state = "limited";
    else {
      const [projects, events] = await Promise.allSettled([
        galleryProjects(db, params, config.origin),
        galleryEvents(db, new URLSearchParams()),
      ]);
      if (projects.status === "fulfilled") initial = projects.value;
      else state = "unavailable";
      if (events.status === "fulfilled") initialEvents = events.value;
    }
  } catch {
    state = "unavailable";
  }
  return (
    <GalleryClient
      initial={initial}
      initialEvents={initialEvents}
      initialQuery={typeof search.q === "string" ? search.q : ""}
      initialEvent={typeof search.event_id === "string" ? search.event_id : ""}
      initialState={state}
    />
  );
}
