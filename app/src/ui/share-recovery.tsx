import { Button, Icon, Tag } from "./components";
import type { LinkedEvent, OwnProject } from "./share-work";
import type { ProjectFields } from "../projects/model";

// A readable recovery copy keeps every supplied field without exposing schema metadata.
export function projectRecoveryText(fields: ProjectFields): string {
  const labels: Record<string, string> = {
    title: "Project name",
    problem: "Problem",
    description: "What you built",
    project_url: "Project link",
    repository_url: "Repository link",
    details: "Additional details",
  };
  const lines = (value: unknown, prefix = ""): string[] => {
    if (value === null || value === undefined || value === "") return [];
    if (Array.isArray(value))
      return value.flatMap((item, index) => lines(item, `${prefix} ${index + 1}`));
    if (typeof value === "object")
      return Object.entries(value).flatMap(([key, item]) =>
        key === "schema_version"
          ? []
          : lines(
              item,
              [prefix, labels[key] ?? key.replaceAll("_", " ")].filter(Boolean).join(" · "),
            ),
      );
    return [`${prefix}: ${String(value)}`];
  };
  return lines(fields).join("\n\n") || "No text entered yet.";
}

export function UnfinishedProjectsView({
  projects,
  events,
  onOpen,
  onNew,
  onHome,
}: {
  projects: OwnProject[];
  events: LinkedEvent[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onHome: () => void;
}) {
  return (
    <section className="share-list">
      <Button variant="quiet" onClick={onHome}>
        <Icon name="back" size={18} /> Back to brag
      </Button>
      <h1>Pick up where you left off.</h1>
      <p className="muted">
        These projects belong to your account, including work started on another device. Choose
        which one to continue.
      </p>
      {projects.map((project) => (
        <article key={project.id} className="access-card share-event" aria-label={project.title}>
          <h2>{project.title}</h2>
          <p>{events.find((event) => event.id === project.eventId)?.title ?? "No event linked"}</p>
          <Tag>{project.status}</Tag>
          <p className="small muted">
            {project.method} · Updated {project.updated}
          </p>
          {project.saved && <p className="small">Your previously saved version is still here.</p>}
          <Button onClick={() => onOpen(project.id)}>Resume {project.title}</Button>
        </article>
      ))}
      <Button variant="secondary" onClick={onNew}>
        Start a separate project
      </Button>
      <p className="small muted">
        Your other projects stay here. You can share a new project with or without an event.
      </p>
    </section>
  );
}

export function UpgradeRecoveryView({
  text,
  hasRecording,
  copied,
  discarded,
  onCopy,
  onManualCopy,
  onDiscard,
  onReload,
}: {
  text: string;
  hasRecording: boolean;
  copied: boolean;
  discarded: boolean;
  onCopy: () => void;
  onManualCopy: (copied: boolean) => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  return (
    <section className="access-card share-capture">
      <h1>A newer version is needed.</h1>
      <p role="alert">
        This change was not saved. Keep this tab open until you have recovered your work.
      </p>
      {!discarded && (
        <>
          <label htmlFor="recovery-text">Your unsaved text</label>
          <textarea
            id="recovery-text"
            className="share-recovery-text"
            readOnly
            value={text}
            rows={8}
          />
          <Button onClick={onCopy}>Copy unsaved text</Button>
          <p className="small" role="status">
            {copied
              ? "Text copy kept. Keep it safe before reloading."
              : "If copying is unavailable, select the text and copy it manually."}
          </p>
          <label className="agent-confirm">
            <input
              type="checkbox"
              checked={copied}
              onChange={(event) => onManualCopy(event.target.checked)}
            />
            I have kept a copy of this text
          </label>
          {hasRecording && (
            <p className="agent-notice">
              Your recording is held in this tab. Copying text does not preserve audio. Reloading
              will lose it; explicitly discard it to continue.
            </p>
          )}
          <Button variant="quiet" onClick={onDiscard}>
            Discard unsaved work
          </Button>
        </>
      )}
      {discarded && (
        <p role="status">Unsaved work discarded. Previously saved projects are unchanged.</p>
      )}
      <Button
        variant="secondary"
        disabled={!discarded && (!copied || hasRecording)}
        onClick={onReload}
      >
        Reload updated app
      </Button>
      <p className="small muted">
        A previous save receipt covers only that saved version, not these unsaved changes.
      </p>
    </section>
  );
}

export function ReauthenticationView({
  blocked,
  checking,
  message,
  onOpen,
  onCheck,
}: {
  blocked: boolean;
  checking: boolean;
  message: string;
  onOpen: () => void;
  onCheck: () => void;
}) {
  return (
    <section className="access-card share-capture">
      <h1>Sign in to resume your work.</h1>
      <p>Your session expired. Your work is held privately in this tab; keep it open.</p>
      {blocked && (
        <p className="access-error" role="alert">
          The sign-in window could not open. Open brag in a separate tab and sign in there, then
          return here.
        </p>
      )}
      <Button onClick={onOpen}>Open sign-in window</Button>
      <Button variant="secondary" onClick={onCheck} disabled={checking}>
        I’m signed in — check again
      </Button>
      <p className="small" role="status">
        {checking
          ? "Checking your session…"
          : message ||
            "Use the same account to resume. Signing in with a different account clears this tab’s retained work."}
      </p>
    </section>
  );
}
