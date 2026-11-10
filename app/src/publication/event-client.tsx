"use client";
import { useRef, useState } from "react";
import type { PublicProjectSummary } from "./model";
import { PublicEventProjectsView } from "../ui/publication";
import { Button } from "../ui/components";
export function PublicEventProjects({
  event,
  initial,
  cursor,
}: {
  event: { id: string; title: string };
  initial: PublicProjectSummary[];
  cursor: string | null;
}) {
  const [projects, setProjects] = useState(initial),
    [next, setNext] = useState(cursor),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    lock = useRef(false);
  async function more() {
    if (lock.current || !next) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/v1/events/${event.id}/projects?cursor=${encodeURIComponent(next)}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      if (!r.ok) throw new Error("Couldn’t load more projects. Please try again.");
      const d = await r.json();
      setProjects((old) => [...old, ...d.projects]);
      setNext(d.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load more projects.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PublicEventProjectsView
        event={event.title}
        projects={projects.map((p) => ({ ...p.content, id: p.id }))}
        onOpen={(id) => {
          if (id) window.location.assign("/projects/" + id);
        }}
      />
      {error && <p role="alert">{error}</p>}
      {next && (
        <Button variant="secondary" disabled={busy} onClick={() => void more()}>
          {busy ? "Loading…" : "Load more projects"}
        </Button>
      )}
    </>
  );
}
