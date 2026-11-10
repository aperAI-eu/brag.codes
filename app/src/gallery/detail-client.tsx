"use client";
import { useEffect, useRef, useState } from "react";
import { GalleryDetailView, GalleryJsonView } from "../ui/gallery";
import type { PublicProject } from "../publication/model";
export function galleryReturn() {
  const current = new URLSearchParams(window.location.search),
    p = new URLSearchParams();
  const q = current.get("q"),
    event = current.get("event_id");
  if (q && Array.from(q).length <= 2000) p.set("q", q);
  if (event && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event))
    p.set("event_id", event);
  return "/slop" + (p.size ? "?" + p : "");
}
export function GalleryDetailClient({ project }: { project: PublicProject | null }) {
  const [json, setJson] = useState(false),
    main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus();
  }, [json]);
  return (
    <main className="access-main" tabIndex={-1} ref={main}>
      {json && project ? (
        <GalleryJsonView
          value={JSON.stringify({ project }, null, 2)}
          onBack={() => setJson(false)}
        />
      ) : (
        <GalleryDetailView
          content={project?.content ?? null}
          published={
            project
              ? new Date(project.published_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })
              : ""
          }
          onBack={() => window.location.assign(galleryReturn())}
          onJson={() => setJson(true)}
        />
      )}
    </main>
  );
}
