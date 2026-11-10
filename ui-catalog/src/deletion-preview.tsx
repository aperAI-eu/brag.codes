"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../app/src/ui/components";
import { DraftAgentEditorView } from "../../app/src/ui/draft-agent";
import {
  OwnProjectsView,
  ShareMessageView,
  ShareShell,
  type OwnProject,
  type ProjectFilter,
} from "../../app/src/ui/share-work";
import {
  OwnerPublishedProjectView,
  ProjectDeleteView,
  ProjectDeletionNotice,
  type DeletionPhase,
} from "../../app/src/ui/project-deletion";
import { eventViews, fictionalPitch, fixtureTime, identities } from "./sharing-fixtures";

const event = "Bratislava Demo Night";
const samples: OwnProject[] = [
  {
    id: "draft-example",
    eventId: "demo-night",
    title: "Offline notes",
    saved: true,
    unfinished: false,
    status: "Ready to edit",
    method: "Typed",
    updated: "just now",
  },
  {
    id: "public-example",
    eventId: "demo-night",
    title: "Community garden map",
    published: true,
    saved: true,
    unfinished: false,
    status: "Published",
    method: "Typed",
    updated: "today",
  },
  {
    id: "voice-example",
    eventId: "demo-night",
    title: "Voice project in progress",
    saved: false,
    unfinished: true,
    status: "Preparing draft",
    method: "Voice",
    updated: "just now",
  },
];
type Outcome = "success" | "failure" | "lost" | "conflict";
export function DeletionPreview({ onExit }: { onExit: () => void }) {
  const [projects, setProjects] = useState(samples);
  const [selected, setSelected] = useState<OwnProject | null>(null);
  const [screen, setScreen] = useState<"list" | "editor" | "delete">("list");
  const [fields, setFields] = useState(() => fictionalPitch("en"));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [phase, setPhase] = useState<DeletionPhase>("confirm");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("success");
  const [expired, setExpired] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const mainRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLDetailsElement>(null);
  const generation = useRef(0),
    restoreFocus = useRef(false);
  useEffect(() => {
    if (restoreFocus.current && screen === "editor" && !expired && !unavailable) {
      mainRef.current?.querySelector<HTMLButtonElement>(".project-delete-section button")?.focus();
      restoreFocus.current = false;
    } else mainRef.current?.focus();
  }, [screen, expired, unavailable]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        screen === "delete" &&
        phase === "confirm" &&
        !expired &&
        !unavailable
      ) {
        restoreFocus.current = true;
        setScreen("editor");
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [screen, phase, expired, unavailable]);
  const reset = (single = false) => {
    generation.current++;
    setProjects(single ? [samples[0]] : samples);
    setSelected(null);
    setScreen("list");
    setDirty(false);
    setNotice(false);
    setFilter("all");
    setPhase("confirm");
    setError("");
    setOutcome("success");
    setExpired(false);
    setUnavailable(false);
  };
  const open = (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    setSelected(project);
    setFields({ ...fictionalPitch("en"), title: project.title });
    setDirty(false);
    setSaved(false);
    setScreen("editor");
    setNotice(false);
  };
  const deleted = () => {
    if (!selected) return;
    setProjects((rows) => rows.filter((p) => p.id !== selected.id));
    setSelected(null);
    setDirty(false);
    setFields(fictionalPitch("en"));
    setNotice(true);
    setScreen("list");
    setPhase("confirm");
  };
  const remove = async () => {
    if (!selected || expired || unavailable || phase !== "confirm") return;
    const attempt = ++generation.current;
    setPhase("deleting");
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (attempt !== generation.current) return;
    if (outcome === "failure") {
      setPhase("confirm");
      setError("Couldn’t delete this project. Nothing was changed. Try again.");
    } else if (outcome === "lost") setPhase("uncertain");
    else if (outcome === "conflict") setPhase("conflict");
    else deleted();
  };
  const begin = () => {
    setPhase("confirm");
    setError("");
    setScreen("delete");
  };
  const signOut = () => {
    generation.current++;
    if (phase === "deleting") setPhase("uncertain");
    setExpired(true);
  };
  return (
    <>
      <aside className="access-fixture-bar" aria-label="Deletion preview controls">
        <strong>Fictional deletion preview · no real project is deleted</strong>
        <div className="access-fixture-actions">
          <label>
            Deletion result{" "}
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
              <option value="success">Success</option>
              <option value="failure">Request fails</option>
              <option value="lost">Response lost after deletion</option>
              <option value="conflict">Project changed elsewhere</option>
            </select>
          </label>
          <Button variant="quiet" onClick={signOut}>
            Expire session
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              generation.current++;
              setUnavailable(true);
            }}
          >
            Simulate unavailable project
          </Button>
          <Button variant="quiet" onClick={() => reset(true)}>
            Only one project
          </Button>
          <Button variant="quiet" onClick={() => reset()}>
            Reset deletion preview
          </Button>
          <Button variant="quiet" onClick={onExit}>
            Back to catalogue
          </Button>
        </div>
      </aside>
      <ShareShell
        user={expired ? null : identities[0]}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={() => {
          if (phase !== "deleting" && phase !== "uncertain") setScreen("list");
        }}
        onSignIn={() => setExpired(false)}
        onSignOut={signOut}
      >
        {expired ? (
          <ShareMessageView
            title="Sign in to continue."
            message="Sign in to the same account to check your project and continue."
            action="Sign in to the same account"
            onAction={() => setExpired(false)}
            onHome={onExit}
          />
        ) : unavailable ? (
          <ShareMessageView
            title="Project unavailable."
            message="This project is no longer available, or you don’t have access."
            action="My projects"
            onAction={() => {
              setUnavailable(false);
              setScreen("list");
            }}
            onHome={onExit}
          />
        ) : screen === "list" ? (
          <>
            {notice && <ProjectDeletionNotice />}
            <OwnProjectsView
              projects={projects}
              events={eventViews(fixtureTime, [], [])}
              filter={filter}
              onFilter={setFilter}
              onOpen={open}
              onShare={onExit}
              onHome={onExit}
            />
          </>
        ) : selected && screen === "delete" ? (
          <ProjectDeleteView
            title={selected.title}
            event={event}
            published={Boolean(selected.published)}
            unsaved={dirty}
            phase={phase}
            error={error}
            onKeep={() => {
              restoreFocus.current = true;
              setScreen("editor");
            }}
            onConfirm={() => void remove()}
            onCheck={deleted}
            onRefresh={() => {
              setSelected({ ...selected, title: "Updated project from another tab" });
              setFields({ ...fields, title: "Updated project from another tab" });
              setDirty(false);
              setPhase("confirm");
              setScreen("editor");
            }}
          />
        ) : selected?.published ? (
          <OwnerPublishedProjectView
            content={{
              title: selected.title,
              event,
              problem: "Local gardeners need a way to find shared growing spaces.",
              description: "A community map of gardens and volunteer days.",
              language: "en",
              author: {
                name: "Alex Example",
                contact: "example.com/alex",
                href: "https://example.com/alex",
              },
              sections: [],
              links: [],
            }}
            onBack={() => setScreen("list")}
            onDelete={begin}
          />
        ) : (
          selected && (
            <DraftAgentEditorView
              fields={fields}
              projectId={selected.id}
              reviewing={false}
              conflict={false}
              blocked={false}
              busy={false}
              saved={saved}
              error=""
              canSend={false}
              onChange={(value) => {
                setFields(value);
                setDirty(true);
                setSaved(false);
              }}
              onSave={() => {
                setProjects((rows) =>
                  rows.map((p) =>
                    p.id === selected.id ? { ...p, title: fields.title, saved: true } : p,
                  ),
                );
                setSelected({ ...selected, title: fields.title });
                setDirty(false);
                setSaved(true);
              }}
              onKeep={() => {}}
              onSend={() => {}}
              onBack={() => setScreen("list")}
              onDelete={begin}
            />
          )
        )}
      </ShareShell>
    </>
  );
}
