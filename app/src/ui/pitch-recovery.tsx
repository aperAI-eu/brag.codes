import type { ProjectFields } from "../projects/model";
import { ProjectEditor } from "./project-capture";
import { Button } from "./components";

export type PitchRecoveryState =
  | "unavailable"
  | "configuration"
  | "ready"
  | "uncertain"
  | "expired"
  | "transcript"
  | "processing"
  | "discarded";

export function PitchRecoveryView({
  state,
  eventTitle,
  processingAudio = true,
  busy = false,
  blocked,
  expires,
  error,
  confirming,
  onRetry,
  onDiscard,
  onConfirm,
  onCancel,
  onType,
}: {
  state: PitchRecoveryState;
  eventTitle: string;
  processingAudio?: boolean;
  busy?: boolean;
  blocked: "" | "closed" | "suspended" | "session";
  expires: string;
  error: string;
  confirming: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onType: () => void;
}) {
  const audio =
    ["configuration", "ready", "uncertain", "unavailable"].includes(state) ||
    (state === "processing" && processingAudio);
  const retry = !busy && !blocked && (state === "ready" || state === "transcript");
  return (
    <section className="access-card capture-card share-capture">
      <p className="eyebrow">{eventTitle} · Private pitch</p>
      <h1>
        {state === "processing"
          ? "Preparing your draft…"
          : state === "discarded"
            ? "Recording discarded."
            : state === "expired"
              ? "Recording unavailable."
              : "Recover your pitch."}
      </h1>
      <p role="status">
        {
          {
            unavailable:
              "This recording cannot be retried safely, or its attempt limit has been reached. You can discard it and continue by typing.",
            configuration:
              "Transcription could not start. The service configuration needs attention. You don’t need to record again.",
            ready:
              "Processing is available. Retry with your retained recording using the current service settings.",
            uncertain:
              "We’re checking whether your pitch was received. Retrying is unavailable until this is resolved, to avoid sending it twice.",
            expired:
              "The recovery period ended. Your recording is no longer available. You can describe your project by typing.",
            transcript:
              "Your transcript is safe. Draft preparation failed; retry uses the transcript without sending audio again.",
            processing:
              "Your recovery attempt is in progress. Please wait before starting another attempt.",
            discarded:
              "Your recording is no longer available for recovery. Existing saved text is unchanged.",
          }[state]
        }
      </p>
      {audio && (
        <p>
          Your recording is private and available until <strong>{expires}</strong>. It is removed
          after transcription succeeds, when you discard it, or when this recovery period ends.
        </p>
      )}
      {state === "transcript" && (
        <p>The recording has been removed. Your private transcript remains available for review.</p>
      )}
      {blocked && (
        <p role="alert">
          {blocked === "closed"
            ? "Submissions are closed. A new processing attempt cannot start."
            : blocked === "suspended"
              ? "This event is unavailable. Recovery actions are paused."
              : "Sign in with the same account to continue. Your recording’s expiry does not change."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {confirming ? (
        <div role="group" aria-label="Confirm recording discard">
          <p>Discard this recording? You will not be able to retry it.</p>
          <Button variant="secondary" onClick={onCancel}>
            Keep recording
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            Confirm discard
          </Button>
        </div>
      ) : (
        <div className="access-fixture-actions">
          {!["expired", "discarded", "processing"].includes(state) && (
            <Button disabled={!retry} onClick={onRetry}>
              {state === "transcript" ? "Retry draft preparation" : "Retry retained recording"}
            </Button>
          )}
          {audio && state !== "processing" && (
            <Button
              variant="secondary"
              disabled={busy || (!!blocked && blocked !== "closed")}
              onClick={onDiscard}
            >
              Discard recording
            </Button>
          )}
          {["expired", "discarded", "transcript"].includes(state) && (
            <Button variant="secondary" disabled={!!blocked} onClick={onType}>
              Continue by typing
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function PitchRecoveryPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      Try retained recording recovery
    </Button>
  );
}

export function PitchRecoveryEditorView({
  fields,
  onChange,
  blocked,
  onSave,
}: {
  fields: ProjectFields;
  onChange: (fields: ProjectFields) => void;
  blocked: boolean;
  onSave: () => void;
}) {
  return (
    <section className="access-card capture-card">
      <h1>Review your project.</h1>
      <p>Recovered work stays private. Review and approve before saving.</p>
      <ProjectEditor value={fields} onChange={onChange} disabled={blocked} />
      <Button
        disabled={blocked || !fields.title || !fields.problem || !fields.description}
        onClick={onSave}
      >
        Approve and save draft
      </Button>
    </section>
  );
}
