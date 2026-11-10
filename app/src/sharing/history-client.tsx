"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../app/account-shell";
import { ProjectDeletionNotice } from "../ui/project-deletion";
import { EventChoiceView } from "../ui/event-choice";
import { Button } from "../ui/components";
import {
  ShareHomeView,
  LinkedEventsView,
  OwnProjectsView,
  ShareMessageView,
  type ProjectFilter,
} from "../ui/share-work";
import { UnfinishedProjectsView } from "../ui/share-recovery";
import type { EventSummary, ProjectSummary } from "../lib/sharing/queries";
import { eventView, projectView, destinations } from "./presentation";
type Context = {
  linked_event_count: number;
  eligible_event_count: number;
  single_eligible_event: EventSummary | null;
  project_count: number;
  unfinished_count: number;
};
export default function HistoryClient({
  view,
}: {
  view: "home" | "events" | "projects" | "share";
}) {
  const { account, loading } = useAccount();
  const [context, setContext] = useState<Context | null>(null),
    [events, setEvents] = useState<EventSummary[]>([]),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [filter, setFilter] = useState<ProjectFilter>("all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [chooseNew, setChooseNew] = useState(false),
    [deletedNotice, setDeletedNotice] = useState(false);
  const sequence = useRef(0);
  const owner = useRef(account?.user.id);
  owner.current = account?.user.id;
  const go = (path: string) => window.location.assign(path),
    choose = (id: string) => go(`/events/${id}/submit`),
    open = (id: string) => {
      const p = projects.find((p) => p.id === id);
      if (p)
        go(
          p.has_publication
            ? `/my/projects/${p.id}`
            : p.event
              ? `/events/${p.event.id}/submit/${p.id}`
              : `/submit/${p.id}`,
        );
    };
  async function request(path: string) {
    const id = owner.current;
    const response = await fetch(path, { cache: "no-store" });
    if (response.status === 401) {
      go("/sign-in?return_to=" + encodeURIComponent(window.location.pathname));
      throw new Error("Sign in to continue.");
    }
    if (!response.ok) throw new Error("Couldn’t load your work. Please try again.");
    const data = await response.json();
    if (id !== owner.current) throw new Error("Your account changed. Reload to continue.");
    return data;
  }
  async function load(more = false) {
    const seq = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const c = await request("/api/v1/me/share-context");
      if (seq !== sequence.current) return;
      setContext(c);
      const endpoint =
        view === "projects" || (view === "share" && !chooseNew && c.unfinished_count > 0)
          ? "projects"
          : "events";
      const state =
        endpoint === "projects"
          ? view === "share"
            ? "unfinished"
            : "all"
          : view === "share" || view === "home"
            ? "eligible"
            : "all";
      const data = await request(
        `/api/v1/me/${endpoint}?state=${state}${more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      if (seq !== sequence.current) return;
      if (endpoint === "projects") {
        setProjects((old) => (more ? [...old, ...data.projects] : data.projects));
        setEvents((old) => [
          ...new Map(
            [
              ...(more ? old : []),
              ...data.projects
                .map((p: ProjectSummary) => p.event)
                .filter((e: EventSummary | null): e is EventSummary => e !== null),
            ].map((e: EventSummary) => [e.id, e]),
          ).values(),
        ]);
      } else setEvents((old) => (more ? [...old, ...data.events] : data.events));
      setCursor(data.next_cursor);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    setDeletedNotice(false);
    if (account?.user.id) {
      try {
        setDeletedNotice(sessionStorage.getItem(`brag-deleted-notice:${account.user.id}`) === "1");
        sessionStorage.removeItem(`brag-deleted-notice:${account.user.id}`);
      } catch {
        /* Non-authoritative notice. */
      }
    }
    setContext(null);
    setEvents([]);
    setProjects([]);
    setCursor(null);
    if (!loading) {
      if (account) void load();
      else if (view !== "home")
        go("/sign-in?return_to=" + encodeURIComponent(window.location.pathname));
      else setBusy(false);
    }
    return () => {
      ++sequence.current;
    };
  }, [account?.user.id, loading, view, chooseNew]);
  const share = () => go(account ? "/share" : "/sign-in?return_to=%2Fshare"),
    home = () => go("/");
  return (
    <main className="access-main">
      {deletedNotice && account && view === "projects" && <ProjectDeletionNotice />}
      {error && (
        <ShareMessageView
          title="Your work is still here."
          message={error}
          action="Try again"
          onAction={() => void load()}
          onHome={home}
        />
      )}
      {!error && view === "home" && (
        <ShareHomeView
          user={account?.user ?? null}
          liveEvents={events.map(eventView)}
          projectCount={context?.project_count ?? 0}
          eventCount={context?.linked_event_count ?? 0}
          onShare={share}
          onNavigate={(d) => go(destinations[d])}
        />
      )}
      {!error && view === "events" && (
        <LinkedEventsView
          events={events.map(eventView)}
          choosing={false}
          onChoose={choose}
          onScan={() => go("/scan")}
          onHome={home}
        />
      )}
      {!error && view === "projects" && (
        <OwnProjectsView
          projects={projects.map(projectView)}
          events={events.map(eventView)}
          filter={filter}
          onFilter={setFilter}
          onOpen={open}
          onShare={share}
          onHome={home}
        />
      )}
      {!error &&
        view === "share" &&
        context &&
        (context.unfinished_count > 0 && !chooseNew ? (
          <UnfinishedProjectsView
            projects={projects.map(projectView)}
            events={events.map(eventView)}
            onOpen={open}
            onNew={() => setChooseNew(true)}
            onHome={home}
          />
        ) : (
          <EventChoiceView
            events={events.map(eventView)}
            retained={false}
            onScan={() => go("/scan")}
            onWithoutEvent={() => go("/submit")}
            onSelect={(event) => choose(event.id)}
            onResume={() => {}}
            onDiscard={() => {}}
          />
        ))}
      {busy && <p role="status">Loading your work…</p>}
      {cursor && !error && (
        <Button variant="secondary" disabled={busy} onClick={() => void load(true)}>
          Load more
        </Button>
      )}
    </main>
  );
}
