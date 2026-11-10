"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../app/account-shell";
import {
  ModerationListView,
  ModerationNavigation,
  ModerationProjectView,
  type ModerationFilter,
  type ModerationPhase,
} from "../ui/moderation";
import { ShareMessageView } from "../ui/share-work";
import type { ModerationProject, ModerationPage, ModerationEvents } from "./model";
import {
  ModerationFailure,
  moderationRequest as request,
  readPending,
  remember,
  type ModerationIntent,
} from "./client-support";

export default function ModerationClient() {
  const { account, loading, failed } = useAccount();
  const last = useRef<string | null>(null);
  if (account?.can_admin) last.current = account.user.id;
  if (!last.current)
    return (
      <main className="access-main">
        <ShareMessageView
          title={
            loading
              ? "Checking admin access…"
              : account
                ? "Moderation access unavailable."
                : "Sign in to continue."
          }
          message={
            failed
              ? "Could not check your session. Retry before continuing."
              : "Moderation requires current platform administrator access."
          }
          action={!loading && !account ? "Sign in" : undefined}
          onAction={() => window.location.assign("/sign-in?return_to=%2Fadmin%2Fmoderation")}
          onHome={() => window.location.assign("/")}
        />
      </main>
    );
  const allowed = !!account?.can_admin && account.user.id === last.current && !failed;
  return (
    <Workspace
      key={last.current}
      actor={last.current}
      allowed={allowed}
      denied={!!account && !allowed}
    />
  );
}
function Workspace({
  actor,
  allowed,
  denied,
}: {
  actor: string;
  allowed: boolean;
  denied: boolean;
}) {
  const storage = "brag-moderation:" + actor;
  const [page, setPage] = useState<ModerationPage>({ projects: [], next_cursor: null });
  const [events, setEvents] = useState<ModerationEvents>({ events: [], next_cursor: null });
  const [entry, setEntry] = useState<ModerationProject | null>(null),
    [phase, setPhase] = useState<ModerationPhase>("list");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<ModerationFilter>("all"),
    [event, setEvent] = useState("");
  const [reason, setReason] = useState(""),
    [expected, setExpected] = useState(0);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [restricted, setRestricted] = useState<"expired" | "denied" | null>(null);
  const [loadFailed, setLoadFailed] = useState(false),
    [initialized, setInitialized] = useState(false);
  const main = useRef<HTMLElement>(null),
    epoch = useRef(0),
    flight = useRef(false),
    pending = useRef<ModerationIntent | null>(null);
  const state = useRef({ entry, phase, allowed, denied });
  state.current = { entry, phase, allowed, denied };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    main.current?.focus();
  }, [phase, restricted, allowed, loadFailed]);
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ModerationFailure && [401, 403].includes(e.status)) {
        setRestricted(e.status === 401 ? "expired" : "denied");
        if (e.status === 403) {
          setReason("");
          pending.current = null;
          remember(storage, null);
        }
        return;
      }
      if (e instanceof ModerationFailure && e.status === 404) {
        const missing = state.current.entry?.id ?? pending.current?.id;
        pending.current = null;
        remember(storage, null);
        setPage((old) => ({ ...old, projects: old.projects.filter((p) => p.id !== missing) }));
        setEntry(null);
        setPhase("list");
        setReason("");
        setNotice("The project is unavailable. It may have been deleted by its author.");
        return;
      }
      if (e instanceof ModerationFailure && e.status === 409) {
        setPhase("conflict");
        return;
      }
      setError(
        e instanceof ModerationFailure && e.status === 429
          ? "Too many requests. Wait a minute, then retry."
          : "Could not complete the request. Your unsent reason is retained. Try again.",
      );
    },
    [storage],
  );
  const loadEvents = useCallback(async (cursor?: string) => {
    const result = await request<ModerationEvents>(
      "admin/moderation/events?limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (mounted.current)
      setEvents((old) => ({
        ...result,
        events: cursor ? [...old.events, ...result.events] : result.events,
      }));
  }, []);
  const loadList = useCallback(
    async (cursor?: string) => {
      const stamp = ++epoch.current;
      setBusy(true);
      setError("");
      setLoadFailed(false);
      try {
        const params = new URLSearchParams({
          query,
          visibility: filter,
          ...(event ? { event_id: event } : {}),
          ...(cursor ? { cursor } : {}),
        });
        const result = await request<ModerationPage>("admin/moderation/projects?" + params);
        if (stamp === epoch.current && mounted.current) {
          setPage((old) => ({
            ...result,
            projects: cursor ? [...old.projects, ...result.projects] : result.projects,
          }));
          setPhase("list");
          setEntry(null);
        }
      } catch (e) {
        if (stamp === epoch.current) {
          fail(e);
          setLoadFailed(true);
        }
      } finally {
        if (stamp === epoch.current) setBusy(false);
      }
    },
    [query, filter, event, fail],
  );
  const refresh = useCallback(
    async (id: string) => request<ModerationProject>("admin/moderation/projects/" + id),
    [],
  );
  const open = async (id: string) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    ++epoch.current;
    try {
      const next = await refresh(id);
      if (mounted.current) {
        setEntry(next);
        setPhase("detail");
        setReason("");
      }
    } catch (e) {
      fail(e);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!allowed || initialized) return;
    setInitialized(true);
    pending.current = readPending(storage);
    void (async () => {
      try {
        await loadEvents();
        if (pending.current) {
          const next = await refresh(pending.current.id);
          setEntry(next);
          setPhase("uncertain");
          setBusy(false);
        } else await loadList();
      } catch (e) {
        fail(e);
        setLoadFailed(true);
        setBusy(false);
      }
    })();
  }, [allowed, initialized, storage, loadEvents, loadList, refresh, fail]);
  useEffect(() => {
    if (!initialized || pending.current || state.current.phase !== "list" || !allowed) return;
    const timer = setTimeout(() => {
      if (state.current.phase === "list" && !flight.current && !pending.current) void loadList();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, filter, event, initialized, allowed, loadList]);
  const recover = useCallback(async () => {
    try {
      const result = await request<{
        account: { user: { id: string }; can_admin: boolean } | null;
      }>("session");
      if (!result.account) {
        setRestricted("expired");
        return;
      }
      if (result.account.user.id !== actor || !result.account.can_admin) {
        setReason("");
        setRestricted("denied");
        pending.current = null;
        remember(storage, null);
        return;
      }
      if (state.current.entry) {
        const next = await refresh(state.current.entry.id);
        setEntry(next);
        if (!pending.current && state.current.phase === "confirm") setPhase("conflict");
      }
      setRestricted(null);
    } catch (e) {
      fail(e);
    }
  }, [actor, storage, refresh, fail]);
  useEffect(() => {
    if (!allowed) {
      ++epoch.current;
      setRestricted(denied ? "denied" : "expired");
      if (denied) {
        setReason("");
        pending.current = null;
        remember(storage, null);
      }
    } else if (restricted) void recover();
  }, [allowed, denied, restricted, recover, storage]);
  useEffect(() => {
    const focus = () => {
      if (restricted) void recover();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [restricted, recover]);
  function clearPending() {
    pending.current = null;
    remember(storage, null);
  }
  async function finish(id: string) {
    const next = await refresh(id);
    setEntry(next);
    clearPending();
    setPhase("detail");
    setReason("");
    setNotice(
      next.hidden
        ? "Project hidden from visitors and agents."
        : next.withdrawn
          ? "Restriction removed. The project remains withdrawn by its author."
          : "Project restored to public discovery.",
    );
  }
  async function submit() {
    if (!entry || busy || flight.current || !allowed || restricted || !reason.trim()) return;
    const intent: ModerationIntent = {
      id: entry.id,
      key: crypto.randomUUID(),
      body: {
        action: entry.hidden ? "restore" : "hide",
        expected_revision: expected,
        reason: reason.trim(),
      },
    };
    pending.current = intent;
    remember(storage, intent);
    flight.current = true;
    setBusy(true);
    setError("");
    let saved = false;
    try {
      await request("projects/" + intent.id + "/moderation", intent.body, intent.key);
      saved = true;
      await finish(intent.id);
    } catch (e) {
      if (e instanceof ModerationFailure && e.status < 500) {
        if (e.status === 401 && saved) setPhase("uncertain");
        else clearPending();
        fail(e);
      } else {
        setPhase("uncertain");
        setError("");
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function check() {
    if (!pending.current || flight.current || !allowed || restricted) return;
    flight.current = true;
    setBusy(true);
    setError("");
    const intent = pending.current;
    try {
      try {
        await request("admin/moderation/receipts/" + intent.key);
      } catch (e) {
        if (!(e instanceof ModerationFailure && e.status === 404)) throw e;
        if (intent.body)
          await request("projects/" + intent.id + "/moderation", intent.body, intent.key);
        else {
          const next = await refresh(intent.id);
          setEntry(next);
          clearPending();
          setPhase("detail");
          setNotice("No saved result was found. Review the current project before another action.");
          return;
        }
      }
      await finish(intent.id);
    } catch (e) {
      if (e instanceof ModerationFailure && [404, 409].includes(e.status)) clearPending();
      fail(e);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function reviewLatest() {
    if (!entry || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await refresh(entry.id);
      setEntry(next);
      setExpected(next.revision);
      setPhase("confirm");
    } catch (e) {
      fail(e);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const message = (title: string, text: string, label?: string, action?: () => void) => (
    <ShareMessageView
      title={title}
      message={text}
      action={label}
      onAction={action}
      onHome={() => window.location.assign("/")}
    />
  );
  return (
    <main className="access-main" ref={main} tabIndex={-1}>
      {!allowed || restricted ? (
        message(
          restricted === "denied" || denied ? "Moderation access unavailable." : "Sign in again.",
          "Moderation data is hidden. Sign in as the same administrator to resume after checking current access and project state.",
          "Sign in",
          () => window.open("/sign-in?return_to=%2Fadmin%2Fmoderation", "_blank", "noopener"),
        )
      ) : (
        <>
          <ModerationNavigation active="moderation" />
          {notice && (
            <p role="status" className="agent-notice">
              {notice}
            </p>
          )}
          {phase === "list" && error && (
            <p role="alert" className="access-error">
              {error}
            </p>
          )}
          {loadFailed && phase === "list" ? (
            message(
              "Could not load moderation.",
              "No managed content is shown. Try again when the connection returns.",
              "Retry load",
              () => void loadList(),
            )
          ) : busy && !entry && !page.projects.length ? (
            message("Loading moderation…", "Retrieving approved publications.")
          ) : entry && phase !== "list" ? (
            <ModerationProjectView
              entry={entry}
              phase={phase}
              reason={reason}
              error={error}
              busy={busy}
              onReason={setReason}
              onBack={() => void loadList()}
              onAction={() => {
                setExpected(entry.revision);
                setPhase("confirm");
                setNotice("");
                setError("");
              }}
              onCancel={() => {
                setReason("");
                setError("");
                setPhase("detail");
              }}
              onConfirm={() => void submit()}
              onCheck={() => void check()}
              onRefresh={() => void reviewLatest()}
            />
          ) : (
            <ModerationListView
              entries={page.projects}
              query={query}
              filter={filter}
              event={event}
              events={events.events}
              more={!!page.next_cursor && !busy}
              onQuery={setQuery}
              onFilter={setFilter}
              onEvent={setEvent}
              onOpen={(id) => void open(id)}
              onMore={() => void loadList(page.next_cursor!)}
              onClear={() => {
                setQuery("");
                setEvent("");
                setFilter("all");
                void loadList();
              }}
              onMoreEvents={
                events.next_cursor
                  ? () => void loadEvents(events.next_cursor!).catch(fail)
                  : undefined
              }
            />
          )}
        </>
      )}
    </main>
  );
}
