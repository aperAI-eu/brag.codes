import type { ProjectFields } from "../projects/model";
import { Button, Tag } from "./components";
import { ProjectDeleteAction } from "./project-deletion";
import { ProjectEditor } from "./project-capture";
import { PublicProjectContentView, type PublicProjectContent } from "./publication";

export type PublicationVisibility = "published" | "withdrawn" | "hidden";
export function PublicationLifecycleEditor({
  fields,
  event,
  visibility,
  version,
  notice,
  error,
  busy,
  onChange,
  onContinue,
  onPublic,
  onWithdraw,
  onDelete,
}: {
  fields: ProjectFields;
  event: string;
  visibility: PublicationVisibility;
  version: number;
  notice: string;
  error: string;
  busy: boolean;
  onChange: (value: ProjectFields) => void;
  onContinue: () => void;
  onPublic: () => void;
  onWithdraw: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="access-card publish-flow" aria-busy={busy}>
      <p className="eyebrow">YOUR PROJECT</p>
      <h1>Edit your project.</h1>
      <div className="share-project-tags">
        <Tag>{event}</Tag>
        <Tag>
          {visibility === "published"
            ? `Published · version ${version}`
            : visibility === "hidden"
              ? "Hidden"
              : "Withdrawn"}
        </Tag>
      </div>
      <p className="muted">
        {visibility === "published"
          ? "Your public page stays unchanged while you edit. Review and publish an update when you are ready."
          : "Your project is private. Review it before publishing again."}
      </p>
      {notice && (
        <p role="status" className="agent-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      <Button variant="secondary" disabled={busy} onClick={onPublic}>
        View current public page
      </Button>
      <ProjectEditor value={fields} onChange={onChange} disabled={busy} />
      <Button disabled={busy} onClick={onContinue}>
        Save and choose public details
      </Button>
      {visibility !== "withdrawn" && (
        <section className="project-delete-section">
          <h2>Take a break from the gallery</h2>
          <p>Hide the public page and listings while keeping your project and private edits.</p>
          <Button variant="secondary" disabled={busy} onClick={onWithdraw}>
            Withdraw from gallery
          </Button>
        </section>
      )}
      <ProjectDeleteAction disabled={busy} onDelete={onDelete} />
    </section>
  );
}

export function PublicationRevisionReview({
  previous,
  next,
  version,
  visibility,
  reviewed,
  busy,
  error,
  onReviewed,
  onEdit,
  onPublish,
}: {
  previous: PublicProjectContent;
  next: PublicProjectContent;
  version: number;
  visibility: PublicationVisibility;
  reviewed: boolean;
  busy: boolean;
  error: string;
  onReviewed: (value: boolean) => void;
  onEdit: () => void;
  onPublish: () => void;
}) {
  return (
    <section className="access-card publish-flow" aria-busy={busy}>
      <Button variant="quiet" disabled={busy} onClick={onEdit}>
        Edit public details
      </Button>
      <h1>
        {visibility === "withdrawn" ? "Review before publishing again." : "Review your update."}
      </h1>
      <p>
        Anyone, including agents, will see the page below. Your project link stays the same. This
        contact change applies only to this project.
      </p>
      <details>
        <summary>Previous publication · version {version}</summary>
        <PublicProjectContentView content={previous} preview />
      </details>
      <h2>Proposed public page</h2>
      <div className="publish-preview">
        <PublicProjectContentView content={next} preview />
      </div>
      <p className="small muted">
        Recordings, transcripts, sign-in details and unselected private fields stay private.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy}
          onChange={(e) => onReviewed(e.target.checked)}
        />
        <span>I reviewed this version and its public contact details.</span>
      </label>
      <Button disabled={!reviewed || busy} onClick={onPublish}>
        {busy ? "Publishing…" : visibility === "withdrawn" ? "Publish again" : "Publish update"}
      </Button>
    </section>
  );
}

export function PublicationWithdrawView({
  title,
  event,
  unsaved,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  event: string;
  unsaved: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="access-card publish-flow" aria-busy={busy}>
      <h1>Withdraw this project?</h1>
      <h2>{title}</h2>
      <Tag>{event}</Tag>
      <p>
        The public page, event listings and gallery results will be unavailable to visitors and
        agents.
      </p>
      <p>Your private project stays. You can edit it and publish again after reviewing it.</p>
      {unsaved && (
        <p className="agent-notice">
          Your unsaved edits stay in this editor. Withdrawal does not publish or discard them.
        </p>
      )}
      <p className="small muted">
        This does not delete your project. Copies already downloaded by others cannot be recalled.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Keep published
      </Button>
      <Button disabled={busy} onClick={onConfirm}>
        {busy ? "Withdrawing…" : "Confirm withdrawal"}
      </Button>
    </section>
  );
}

export function PublicationLifecyclePreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      Try public updates and withdrawal
    </Button>
  );
}

export function LifecyclePublicView({
  content,
  onBack,
}: {
  content: PublicProjectContent;
  onBack: () => void;
}) {
  return (
    <section className="access-card publish-flow">
      <Button variant="quiet" onClick={onBack}>
        Back to private editor
      </Button>
      <PublicProjectContentView content={content} />
    </section>
  );
}
