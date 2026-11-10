"use client";
import { useEffect, useRef, useState } from "react";
import { GalleryView, type GalleryState } from "../ui/gallery";
import type { GalleryPage, GalleryEvents } from "./model";
export function GalleryClient({
  initial,
  initialEvents,
  initialQuery,
  initialEvent,
  initialState,
}: {
  initial: GalleryPage | null;
  initialEvents: GalleryEvents | null;
  initialQuery: string;
  initialEvent: string;
  initialState: GalleryState;
}) {
  const [query, setQuery] = useState(initialQuery),
    [event, setEvent] = useState(initialEvent);
  const [page, setPage] = useState(initial),
    [events, setEvents] = useState(initialEvents);
  const [state, setState] = useState<GalleryState>(initialState);
  const [loadingMore, setLoadingMore] = useState(false),
    [loadingEvents, setLoadingEvents] = useState(false),
    [pageError, setPageError] = useState("");
  const applied = useRef({ query: initialQuery, event: initialEvent }),
    generation = useRef(0),
    lock = useRef(false),
    eventLock = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function locationFor(q: string, e: string) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (e) p.set("event_id", e);
    return "/slop" + (p.size ? "?" + p : "");
  }
  async function load(append = false, clear = false) {
    if (append && lock.current) return;
    const epoch = ++generation.current;
    lock.current = true;
    const chosen = append
      ? applied.current
      : { query: clear ? "" : query.trim(), event: clear ? "" : event };
    if (!append) {
      applied.current = chosen;
      setQuery(chosen.query);
      setEvent(chosen.event);
      setState("loading");
      window.history.replaceState(null, "", locationFor(chosen.query, chosen.event));
    } else setLoadingMore(true);
    setPageError("");
    const params = new URLSearchParams({ q: chosen.query });
    if (chosen.event) params.set("event_id", chosen.event);
    if (append && page?.next_cursor) params.set("cursor", page.next_cursor);
    try {
      const response = await fetch("/api/v1/projects?" + params, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (epoch !== generation.current) return;
      if (!response.ok) {
        if (append)
          setPageError(
            response.status === 429
              ? "Too many requests. Wait a minute before loading more."
              : "Couldn’t load more projects. Your current results are still here.",
          );
        else setState(response.status === 429 ? "limited" : "unavailable");
        return;
      }
      const value: GalleryPage = await response.json();
      if (epoch !== generation.current) return;
      setPage(
        append
          ? {
              ...value,
              projects: [...(page?.projects ?? []), ...value.projects].filter(
                (item, index, all) => all.findIndex((p) => p.id === item.id) === index,
              ),
            }
          : value,
      );
      setState("ready");
    } catch {
      if (epoch === generation.current) {
        if (append)
          setPageError("Couldn’t load more projects. Your current results are still here.");
        else setState("unavailable");
      }
    } finally {
      if (epoch === generation.current) {
        lock.current = false;
        setLoadingMore(false);
      }
    }
  }
  async function loadEvents() {
    if (eventLock.current) return;
    eventLock.current = true;
    setLoadingEvents(true);
    try {
      const params = new URLSearchParams();
      if (events?.next_cursor) params.set("cursor", events.next_cursor);
      const response = await fetch("/api/v1/gallery/events?" + params, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error();
      const value: GalleryEvents = await response.json();
      setEvents({
        ...value,
        events: [...(events?.events ?? []), ...value.events].filter(
          (e, i, all) => all.findIndex((x) => x.id === e.id) === i,
        ),
      });
      setPageError("");
    } catch {
      setPageError("Couldn’t load event choices. Select Load more events to retry.");
    } finally {
      eventLock.current = false;
      setLoadingEvents(false);
    }
  }
  const choices = events?.events ?? [];
  const scopedChoices =
    event && !choices.some((e) => e.id === event)
      ? [{ id: event, title: "Selected event" }, ...choices]
      : choices;
  return (
    <main className="access-main" tabIndex={-1}>
      <GalleryView
        items={(page?.projects ?? []).map((p) => ({
          id: p.id,
          title: p.content.title,
          problem: p.content.problem,
          author: p.content.author.name,
          event: p.event?.title ?? "No event linked",
          published: new Date(p.published_at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }),
          matchedFields: p.matched_fields,
        }))}
        query={query}
        event={event}
        events={scopedChoices}
        state={state}
        hasMore={Boolean(page?.next_cursor)}
        loadingMore={loadingMore}
        pageError={pageError}
        moreEvents={!events || Boolean(events.next_cursor)}
        loadingEvents={loadingEvents}
        onMoreEvents={() => void loadEvents()}
        onQuery={setQuery}
        onEvent={setEvent}
        onSearch={() => void load()}
        onClear={() => void load(false, true)}
        onMore={() => void load(true)}
        onRefresh={() => {
          void load();
          if (!events) void loadEvents();
        }}
        onOpen={(id) => {
          const p = new URLSearchParams({ from: "slop" });
          if (applied.current.query) p.set("q", applied.current.query);
          if (applied.current.event) p.set("event_id", applied.current.event);
          window.location.assign(`/projects/${id}?${p}`);
        }}
        onAgents={() => window.location.assign("/agents" + window.location.search)}
      />
    </main>
  );
}
