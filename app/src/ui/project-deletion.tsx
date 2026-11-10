import { Button, Tag } from "./components";
import { PublicProjectContentView, type PublicProjectContent } from "./publication";

export function ProjectDeleteAction({
  disabled = false,
  onDelete,
}: {
  disabled?: boolean;
  onDelete: () => void;
}) {
  return (
    <section className="project-delete-section" aria-label="Delete this project">
      <h2>Delete project</h2>
      <p className="muted">Remove this project and its content. This cannot be undone.</p>
      <Button
        variant="secondary"
        className="project-delete-button"
        disabled={disabled}
        onClick={onDelete}
      >
        Delete project
      </Button>
    </section>
  );
}

export type DeletionPhase = "confirm" | "deleting" | "uncertain" | "conflict";
export function ProjectDeleteView({
  title,
  event,
  published,
  unsaved,
  phase,
  error,
  onKeep,
  onConfirm,
  onCheck,
  onRefresh,
}: {
  title: string;
  event: string;
  published: boolean;
  unsaved: boolean;
  phase: DeletionPhase;
  error: string;
  onKeep: () => void;
  onConfirm: () => void;
  onCheck: () => void;
  onRefresh: () => void;
}) {
  const busy = phase === "deleting";
  return (
    <section className="access-card capture-card" aria-busy={busy}>
      <h1>Delete this project?</h1>
      <h2 className="project-delete-title">{title || "Untitled project"}</h2>
      <div className="share-project-tags">
        <Tag>{event}</Tag>
        <Tag>{published ? "Published" : "Private"}</Tag>
      </div>
      <p>
        This cannot be undone. Your saved content will be removed, pending work stopped and agent
        access cancelled.
      </p>
      {published && (
        <p className="agent-notice">
          The public project page and its event listings will also be removed.
        </p>
      )}
      {unsaved && (
        <p className="agent-notice">
          You have unsaved changes. Deleting also discards these edits.
        </p>
      )}
      <p className="small muted">
        Your account, events and other projects stay. Retained copies are cleaned up separately;
        copies downloaded by others cannot be recalled.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      {phase === "uncertain" ? (
        <>
          <p role="status">
            The connection was interrupted. We haven’t confirmed whether deletion finished. Check
            before trying again.
          </p>
          <Button onClick={onCheck}>Check deletion</Button>
        </>
      ) : phase === "conflict" ? (
        <>
          <p role="alert">
            This project changed in another tab. Review the latest project before deciding to delete
            it.
          </p>
          <Button onClick={onRefresh}>Review latest project</Button>
        </>
      ) : (
        <div className="access-fixture-actions">
          <Button variant="secondary" disabled={busy} onClick={onKeep}>
            Keep project
          </Button>
          <Button className="project-delete-button" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function OwnerPublishedProjectView({
  content,
  onBack,
  onDelete,
}: {
  content: PublicProjectContent;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="access-card capture-card">
      <Button variant="quiet" onClick={onBack}>
        Back to my projects
      </Button>
      <p className="eyebrow">YOUR PUBLISHED PROJECT</p>
      <PublicProjectContentView content={content} />
      <ProjectDeleteAction onDelete={onDelete} />
    </section>
  );
}

export function ProjectDeletionNotice() {
  return (
    <p role="status" className="agent-notice">
      Project deleted.
    </p>
  );
}

export function ProjectDeletionPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      Try project deletion
    </Button>
  );
}
