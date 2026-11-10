import type { ProjectFields } from "../projects/model";
import { Button, Icon } from "./components";
import { CaptureChoices, ProjectEditor } from "./project-capture";
import { PitchProgress } from "./pitch-progress";
import { PitchRecorderView, type PitchRecorderControls } from "./pitch-recorder";
import type { LinkedEvent } from "./share-work";
import { AgentHandoffView, AgentSteps, type AgentHandoffControls } from "./agent-handoff";

export type CaptureStage =
  | "choice"
  | "typed"
  | "voice"
  | "recording"
  | "paused"
  | "held"
  | "transcribing"
  | "structuring"
  | "proposal"
  | "agent"
  | "saved"
  | "failed";
export function EventCaptureView({
  event,
  stage,
  fields,
  recorder,
  agent,
  agentReview,
  finishReason,
  busy,
  error,
  onChange,
  onMethod,
  onStop,
  onSave,
  onBack,
  onAnother,
  onProjects,
  onPublish,
  published = false,
  readOnly = false,
  saved = false,
  legacy = false,
  canSave = false,
  transcript = "",
  onRetry,
  onDiscard,
}: {
  event: LinkedEvent | null;
  stage: CaptureStage;
  fields: ProjectFields;
  recorder: PitchRecorderControls;
  agent: AgentHandoffControls;
  agentReview: boolean;
  finishReason: string;
  busy: boolean;
  error: string;
  readOnly?: boolean;
  saved?: boolean;
  legacy?: boolean;
  canSave?: boolean;
  transcript?: string;
  onRetry: () => void;
  onDiscard: () => void;
  onChange: (value: ProjectFields) => void;
  onMethod: (method: "typed" | "voice" | "agent") => void;
  onStop: () => void;
  onSave: () => void;
  onBack: () => void;
  onAnother: () => void;
  onProjects: () => void;
  onPublish?: () => void;
  published?: boolean;
}) {
  const unavailable = event !== null && event.state !== "open";
  const reviewing = stage === "proposal";
  return (
    <section className="access-card capture-card share-capture">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={18} /> Back to brag
      </Button>
      <p className="eyebrow">{event?.title ?? "No event linked"}</p>
      {event && (
        <p className="small muted">
          Submissions: {event.from} – {event.to} · {event.timezone}
        </p>
      )}
      {unavailable && event && (
        <p className="access-error" role="alert">
          {event.state === "suspended"
            ? "This event is suspended. Editing and uploads are unavailable until the administrator restores access. Your text is retained."
            : event.state === "scheduled"
              ? "Submissions are not open yet."
              : "Submissions are closed. No new projects or processing attempts can start."}
          {canSave && " You can still finish received work or edit your saved project."}
        </p>
      )}
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      {stage === "choice" && (
        <fieldset disabled={unavailable} className="share-methods">
          <CaptureChoices onChoose={onMethod} pitchSeconds={30} />
        </fieldset>
      )}
      {(stage === "typed" || reviewing) && (
        <>
          <h1>
            {saved
              ? legacy
                ? "Your existing draft."
                : "Your saved project."
              : reviewing
                ? "Review your project."
                : "Tell us what you built."}
          </h1>
          <p className="muted">
            {saved
              ? readOnly
                ? "Your saved project is readable while the event is suspended. Unsaved changes are retained in this tab."
                : published
                  ? "Edit your private working copy and save your changes."
                  : "Only you can see this project. Edit the form and save your changes."
              : reviewing
                ? "Check the prefilled details, edit anything, then approve and save. The original language is preserved."
                : "Rough bullets are fine. Links are optional."}
          </p>
          {saved && !published && (
            <p className="agent-notice">
              AI agents prepare new unfinished projects. This saved project can be changed only
              through your form; old upload instructions cannot overwrite it.
            </p>
          )}
          {reviewing && !saved && event && (
            <p className="small">
              Received during the submission window. You may review and save this result after
              closing.
            </p>
          )}
          {published && (
            <p className="agent-notice">
              Your public page contains the version you approved. Saving private edits does not
              change that page.
            </p>
          )}
          {onPublish && saved && (
            <Button variant="secondary" onClick={onPublish} disabled={busy}>
              {published ? "View public project" : "Continue to publication"}
            </Button>
          )}
          <ProjectEditor value={fields} onChange={onChange} disabled={busy || readOnly} />
          {reviewing && (agentReview ? <AgentSteps step={1} /> : <PitchProgress stage="review" />)}
          {!readOnly && (
            <Button onClick={onSave} disabled={!canSave || busy}>
              {busy ? "Saving…" : reviewing ? "Approve and save draft" : "Save draft"}
            </Button>
          )}
          {reviewing && agentReview && !saved && (
            <Button variant="quiet" onClick={onDiscard} disabled={busy}>
              Discard unfinished project
            </Button>
          )}
          {readOnly && (
            <Button variant="secondary" onClick={onProjects}>
              Back to my projects
            </Button>
          )}
          <p className="small muted">
            {saved
              ? "Previously saved version retained · edits need an explicit save"
              : "Private draft · not saved yet"}
          </p>
        </>
      )}
      {(stage === "voice" || stage === "recording" || stage === "paused") && (
        <PitchRecorderView phase={stage} disabled={unavailable} {...recorder} />
      )}
      {stage === "failed" && (
        <>
          <h1>Your pitch needs attention.</h1>
          <p role="alert">Processing failed. No new project description was saved.</p>
          {transcript && (
            <>
              <h2>Retained transcript</h2>
              <p className="agent-notice">{transcript}</p>
            </>
          )}
          <p>
            {unavailable
              ? "Submissions have closed, so processing cannot be retried and a new description cannot be submitted. Keep this transcript for reference or discard the unfinished project."
              : event
                ? "You can retry processing while submissions are open, or discard this unfinished project."
                : "You can retry processing or discard this unfinished project."}
          </p>
          <Button onClick={onRetry} disabled={unavailable}>
            Retry processing
          </Button>
          {!saved && (
            <Button variant="quiet" onClick={onDiscard}>
              Discard unfinished project
            </Button>
          )}
          {saved && (
            <Button variant="secondary" onClick={onProjects}>
              Back to my projects
            </Button>
          )}
        </>
      )}
      {stage === "held" && (
        <>
          <h1>Recording retained.</h1>
          <p>
            No pitch was uploaded. You can process this recording if submissions reopen, or return
            home to discard it explicitly.
          </p>
          <Button onClick={onStop} disabled={unavailable}>
            Process retained recording
          </Button>
        </>
      )}
      {(stage === "transcribing" || stage === "structuring") && (
        <>
          <p role="status">{finishReason}</p>
          <PitchProgress stage={stage} />
        </>
      )}
      {stage === "agent" && (
        <AgentHandoffView
          {...agent}
          eventTitle={event?.title ?? "No event linked"}
          disabled={unavailable}
        />
      )}
      {stage === "saved" && (
        <>
          {agentReview ? <AgentSteps step={3} /> : <PitchProgress stage="saved" />}
          <h1>Project saved.</h1>
          <p>
            <strong>{fields.title || "Untitled project"}</strong> is a private draft
            {event ? ` at ${event.title}` : " with no event linked"}.
          </p>
          {onPublish && <Button onClick={onPublish}>Continue to publication</Button>}
          <Button variant="secondary" onClick={onAnother}>
            Share another project
          </Button>
          <Button variant="secondary" onClick={onProjects}>
            View my projects
          </Button>
        </>
      )}
    </section>
  );
}
