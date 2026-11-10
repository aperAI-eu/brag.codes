"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../app/src/ui/components";
import { ShareMessageView, ShareShell } from "../../app/src/ui/share-work";
import {
  ModerationListView,
  ModerationNavigation,
  ModerationProjectView,
  type ModerationEntry,
  type ModerationFilter,
  type ModerationPhase,
} from "../../app/src/ui/moderation";

function samples(): ModerationEntry[] {
  return ["Offline notes", "Community map", "Tiny garden", "Workshop planner"].map(
    (title, index) => ({
      id: `demo-project-${index + 1}`,
      version: 1,
      revision: 1,
      hidden: index === 1,
      withdrawn: index === 2,
      content: {
        title,
        problem: "Useful community ideas get lost between meetups.",
        description:
          "A small description-only project built to share practical lessons with other builders.",
        event: index === 3 ? null : index % 2 ? "Prague Builders" : "Bratislava Demo Night",
        language: "en",
        author: {
          name: "Alex Builder",
          contact: "https://example.com/alex",
          href: "https://example.com/alex",
        },
        links: [],
        sections: [],
      },
      history:
        index === 1
          ? [
              {
                id: "seed",
                action: "Hidden",
                actor: "Jan Demo",
                at: "10 Nov 2026, 10:00 UTC",
                reason: "Misleading public description; review requested.",
              },
            ]
          : [],
    }),
  );
}
const admin = { id: "demo-admin", name: "Jan Demo", email: "jan@example.test" };
export function ModerationPreview({ onExit }: { onExit: () => void }) {
  const [entries, setEntries] = useState(samples);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<ModerationPhase>("list");
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ModerationFilter>("all");
  const [event, setEvent] = useState("");
  const [limit, setLimit] = useState(2);
  const [expected, setExpected] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [access, setAccess] = useState<"admin" | "expired" | "denied">("admin");
  const [load, setLoad] = useState<"ready" | "loading" | "failed" | "empty">("ready");
  const [outcome, setOutcome] = useState<"success" | "failed" | "lost">("success");
  const [busy, setBusy] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const live = useRef({ access, entries });
  live.current = { access, entries };
  useEffect(
    () => () => {
      generation.current++;
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  useEffect(() => {
    mainRef.current?.focus();
  }, [phase, access, load]);
  const entry = entries.find((item) => item.id === selected);
  const filtered = entries.filter(
    (item) =>
      (!query.trim() ||
        [item.content.title, item.content.description, item.content.author.name]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
      (!event || item.content.event === event) &&
      (filter === "all" ||
        (filter === "hidden" && item.hidden) ||
        (filter === "withdrawn" && item.withdrawn) ||
        (filter === "published" && !item.hidden && !item.withdrawn)),
  );
  function reset() {
    generation.current++;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setEntries(samples());
    setSelected(null);
    setPhase("list");
    setReason("");
    setQuery("");
    setFilter("all");
    setEvent("");
    setLimit(2);
    setExpected(1);
    setNotice("");
    setError("");
    setAccess("admin");
    setLoad("ready");
    setOutcome("success");
    setBusy(false);
  }
  function back() {
    setPhase("list");
    setSelected(null);
    setReason("");
    setError("");
  }
  function confirm() {
    if (!entry || busy || !reason.trim() || access !== "admin" || phase !== "confirm") return;
    if (entry.revision !== expected) {
      setPhase("conflict");
      return;
    }
    setBusy(true);
    setError("");
    const stamp = generation.current;
    const intent = { ...entry };
    const savedReason = reason.trim();
    timers.current.push(
      setTimeout(() => {
        if (generation.current !== stamp) return;
        setBusy(false);
        if (live.current.access !== "admin") return;
        const current = live.current.entries.find((item) => item.id === intent.id);
        if (!current) {
          back();
          setNotice("The project was deleted by its author. There is nothing to restore.");
          return;
        }
        if (current.revision !== intent.revision) {
          setPhase("conflict");
          return;
        }
        if (outcome === "failed") {
          setError("The action was not saved. Your reason is retained. Try again.");
          setOutcome("success");
          return;
        }
        setEntries((items) =>
          items.map((item) =>
            item.id === intent.id
              ? {
                  ...item,
                  hidden: !intent.hidden,
                  revision: item.revision + 1,
                  history: [
                    {
                      id: `action-${item.revision + 1}`,
                      action: intent.hidden ? "Restored" : "Hidden",
                      actor: admin.name,
                      at: "10 Nov 2026, 11:00 UTC",
                      reason: savedReason,
                    },
                    ...item.history,
                  ],
                }
              : item,
          ),
        );
        setOutcome("success");
        if (outcome === "lost") {
          setPhase("uncertain");
          return;
        }
        setReason("");
        setPhase("detail");
        setNotice(
          intent.hidden
            ? intent.withdrawn
              ? "Restriction removed. The project remains withdrawn by its author."
              : "Project restored to public discovery."
            : "Project hidden from visitors and agents.",
        );
      }, 350),
    );
  }
  function mutate(kind: "withdraw" | "change" | "delete") {
    if (!entry) return;
    if (kind === "delete") {
      setEntries((items) => items.filter((item) => item.id !== entry.id));
      back();
      setNotice("The project was deleted by its author. There is nothing to restore.");
    } else
      setEntries((items) =>
        items.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                revision: item.revision + 1,
                withdrawn: kind === "withdraw" ? true : item.withdrawn,
              }
            : item,
        ),
      );
  }
  const message = (title: string, description: string, label: string, action: () => void) => (
    <ShareMessageView
      title={title}
      message={description}
      action={label}
      onAction={action}
      onHome={onExit}
    />
  );
  return (
    <>
      <div className="preview-strip">
        <span>FICTIONAL MODERATION · No server changes</span>
        <Button variant="quiet" onClick={reset}>
          Reset moderation preview
        </Button>
        <Button variant="quiet" onClick={onExit}>
          Catalogue
        </Button>
      </div>
      <ShareShell
        user={access === "admin" ? admin : null}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={onExit}
        onSignIn={() => {
          setAccess("admin");
          if (phase === "confirm") setPhase("conflict");
        }}
        onSignOut={() => {
          setReason("");
          setAccess("expired");
        }}
      >
        {access === "admin" && (
          <ModerationNavigation
            active="moderation"
            onNavigate={(destination) => (destination === "/admin/moderation" ? back() : onExit())}
          />
        )}
        {access === "expired" ? (
          message(
            "Sign in again.",
            "Your session expired. Moderation data is hidden. The same administrator can resume after checking access and current state.",
            "Resume as Jan Demo",
            () => {
              setAccess("admin");
              if (phase === "confirm") setPhase("conflict");
            },
          )
        ) : access === "denied" ? (
          message(
            "Moderation access unavailable.",
            "Your account no longer has the platform administrator role.",
            "Return to catalogue",
            onExit,
          )
        ) : load === "loading" ? (
          message(
            "Loading moderation…",
            "Retrieving approved publications.",
            "Finish simulated load",
            () => setLoad("ready"),
          )
        ) : load === "failed" ? (
          message(
            "Could not load moderation.",
            "No managed content is shown. Try again when the connection returns.",
            "Retry load",
            () => setLoad("ready"),
          )
        ) : (
          <>
            {notice && (
              <p role="status" className="agent-notice">
                {notice}
              </p>
            )}
            {phase === "list" || !entry ? (
              <ModerationListView
                entries={load === "empty" ? [] : filtered.slice(0, limit)}
                query={query}
                filter={filter}
                event={event}
                events={["Bratislava Demo Night", "Prague Builders"].map((title) => ({
                  id: title,
                  title,
                }))}
                more={load !== "empty" && filtered.length > limit}
                onQuery={(value) => {
                  setQuery(value);
                  setLimit(2);
                }}
                onFilter={(value) => {
                  setFilter(value);
                  setLimit(2);
                }}
                onEvent={(value) => {
                  setEvent(value);
                  setLimit(2);
                }}
                onClear={() => {
                  setQuery("");
                  setEvent("");
                  setFilter("all");
                  setLoad("ready");
                }}
                onMore={() => setLimit((value) => value + 2)}
                onOpen={(id) => {
                  setSelected(id);
                  setPhase("detail");
                  setNotice("");
                }}
              />
            ) : (
              <ModerationProjectView
                entry={entry}
                phase={phase}
                reason={reason}
                error={error}
                busy={busy}
                onReason={setReason}
                onBack={back}
                onAction={() => {
                  setExpected(entry.revision);
                  setPhase("confirm");
                  setNotice("");
                }}
                onCancel={() => {
                  setReason("");
                  setError("");
                  setPhase("detail");
                }}
                onConfirm={confirm}
                onCheck={() => {
                  setReason("");
                  setPhase("detail");
                  setNotice(
                    "Original action confirmed. History contains one saved action; current visibility is shown below.",
                  );
                }}
                onRefresh={() => {
                  setExpected(entry.revision);
                  setPhase("confirm");
                  setError("");
                }}
              />
            )}
          </>
        )}
      </ShareShell>
      <details className="access-card">
        <summary>Fictional scenario controls</summary>
        <div className="access-fixture-actions">
          <Button variant="secondary" onClick={() => setAccess("expired")}>
            Expire session
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setAccess("denied");
              setReason("");
              setNotice("");
            }}
          >
            Revoke admin role
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setAccess("denied");
              setReason("");
              setNotice("");
            }}
          >
            Resume as ordinary user
          </Button>
          <Button variant="secondary" onClick={() => setLoad("loading")}>
            Simulate loading
          </Button>
          <Button variant="secondary" onClick={() => setLoad("failed")}>
            Simulate offline load
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              back();
              setLoad("empty");
            }}
          >
            Simulate empty list
          </Button>
          <Button variant="secondary" onClick={() => setOutcome("failed")}>
            Fail next action
          </Button>
          <Button variant="secondary" onClick={() => setOutcome("lost")}>
            Lose next response
          </Button>
          <Button variant="secondary" disabled={!entry} onClick={() => mutate("change")}>
            Change project elsewhere
          </Button>
          <Button variant="secondary" disabled={!entry} onClick={() => mutate("withdraw")}>
            Author withdraws project
          </Button>
          <Button variant="secondary" disabled={!entry} onClick={() => mutate("delete")}>
            Author deletes project
          </Button>
        </div>
        <p className="small muted">
          All sample data lives in this tab. Reload clears unsent reasons and fixture changes.
        </p>
      </details>
    </>
  );
}
