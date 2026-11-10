import { ProjectDeleteAction } from "./project-deletion";
import type { ProjectFields } from "../projects/model";
import { Button } from "./components";
import { ProjectEditor } from "./project-capture";
import { AgentHandoffView, type AgentHandoffControls } from "./agent-handoff";

export function DraftAgentEditorView({
  fields,
  projectId,
  eventTitle,
  reviewing,
  voiceReview = false,
  conflict,
  blocked,
  busy,
  error,
  saved,
  onChange,
  onSend,
  onSave,
  onKeep,
  onPublish,
  onBack,
  canSend = true,
  onDelete,
}: {
  fields: ProjectFields;
  projectId: string;
  eventTitle?: string;
  reviewing: boolean;
  voiceReview?: boolean;
  conflict: boolean;
  blocked: boolean;
  busy: boolean;
  error: string;
  saved: boolean;
  onChange: (fields: ProjectFields) => void;
  onSend: () => void;
  onSave: () => void;
  onKeep: () => void;
  onPublish?: () => void;
  onBack?: () => void;
  canSend?: boolean;
  onDelete?: () => void;
}) {
  return (
    <section className="access-card capture-card">
      <h1>
        {reviewing
          ? "Review your agent’s changes."
          : voiceReview
            ? "Review your project."
            : "Your project draft."}
      </h1>
      <p className="small muted">
        Private project · <code>{projectId}</code>
      </p>
      {eventTitle && <p className="small muted">{eventTitle}</p>}
      <p>
        {reviewing
          ? "Your original draft is kept until you approve these changes."
          : "Keep editing here, or let your agent refine the current content."}
      </p>
      {blocked && <p role="alert">Editing access is unavailable. Your content is kept here.</p>}
      {conflict && (
        <p role="alert">
          This project changed after the handoff. Return to your latest draft before asking the
          agent again.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Draft saved. The project stays private.</p>}
      <div className="access-fixture-actions">
        {!reviewing && (
          <Button
            variant="secondary"
            disabled={blocked || busy || conflict || !canSend}
            onClick={onSend}
          >
            {busy ? "Preparing instructions…" : "Send to your agent"}
          </Button>
        )}
        <Button disabled={blocked || busy || conflict} onClick={onSave}>
          {reviewing || voiceReview ? "Approve and save draft" : "Save draft"}
        </Button>
        {(reviewing || conflict) && (
          <Button variant="quiet" disabled={busy} onClick={onKeep}>
            {conflict ? "Return to latest draft" : "Keep my draft"}
          </Button>
        )}
      </div>
      {!reviewing && (
        <p className="small muted">
          The instruction shares this project’s ID and current content, including unsaved edits,
          with the agent you choose. You review its proposal before saving.
        </p>
      )}
      {onPublish && (
        <Button onClick={onPublish} disabled={busy || blocked}>
          Continue to publication
        </Button>
      )}
      {onBack && (
        <Button variant="quiet" onClick={onBack} disabled={busy}>
          Back to my projects
        </Button>
      )}
      <ProjectEditor value={fields} onChange={onChange} disabled={blocked || busy || conflict} />
      {onDelete && !reviewing && <ProjectDeleteAction disabled={busy} onDelete={onDelete} />}
    </section>
  );
}

export function DraftAgentHandoffView({
  projectId,
  version,
  controls,
  blocked,
  busy = false,
  onBack,
}: {
  projectId: string;
  version: number;
  controls: AgentHandoffControls;
  busy?: boolean;
  blocked: boolean;
  onBack: () => void;
}) {
  return (
    <section className="access-card capture-card">
      <p className="small muted">
        Private project · <code>{projectId}</code> · Version {version}
      </p>
      <p>
        The instruction includes a snapshot of your current project. Your agent can rewrite or
        complete it; you decide what to save.
      </p>
      {blocked && <p role="alert">Editing access is unavailable. Your draft is retained.</p>}
      <AgentHandoffView
        {...controls}
        eventTitle="Existing project refinement"
        disabled={blocked || busy}
      />
      <Button
        variant="quiet"
        onClick={onBack}
        disabled={blocked || busy || controls.statusUnavailable}
      >
        Back to my draft
      </Button>
    </section>
  );
}

export function DraftAgentPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      Try agent draft refinement
    </Button>
  );
}
