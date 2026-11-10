import { Button, Icon } from "./components";

export type AgentPhase = "waiting" | "received" | "expired" | "cancelled" | "unavailable";
export type AgentHandoffControls = {
  phase: AgentPhase;
  instruction: string;
  expires: string;
  statusUnavailable: boolean;
  copyStatus: "idle" | "copying" | "copied" | "failed";
  onCopy: () => void;
  onCancel: () => void;
  onRestart: () => void;
  onRetry: () => void;
};

export function AgentSteps({ step }: { step: number }) {
  return (
    <ol className="agent-steps" aria-label="Agent proposal progress">
      {["Send proposal", "Review", "Save"].map((label, index) => (
        <li key={label} aria-current={index === step ? "step" : undefined}>
          <span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function AgentHandoffView({
  eventTitle,
  disabled,
  phase,
  instruction,
  expires,
  statusUnavailable,
  copyStatus,
  onCopy,
  onCancel,
  onRestart,
  onRetry,
}: AgentHandoffControls & { eventTitle: string; disabled: boolean }) {
  const ended = phase === "expired" || phase === "cancelled";
  return (
    <div className="agent-handoff">
      <div>
        <h1>Use your AI agent.</h1>
        <p className="muted">Your agent prepares the pitch. You review and save it here.</p>
      </div>
      <AgentSteps step={0} />
      {statusUnavailable && (
        <div className="agent-notice" role="alert">
          <strong>Couldn’t check for your proposal.</strong>
          <p>
            Your agent may still be able to upload. Check again before creating new instructions.
          </p>
          <Button variant="secondary" onClick={onRetry}>
            Check for proposal
          </Button>
        </div>
      )}
      {!ended && phase !== "unavailable" && (
        <>
          <section className="agent-panel" aria-labelledby="agent-send-title">
            <h2 id="agent-send-title">Give this to your agent</h2>
            <p className="small muted">
              Open your project in your AI tool. Paste this instruction into its chat, then return
              here to review the proposal.
            </p>
            <label className="small" htmlFor="agent-instruction">
              Agent instruction
            </label>
            <textarea id="agent-instruction" readOnly value={instruction} rows={7} />
            <Button
              onClick={onCopy}
              disabled={disabled || statusUnavailable || copyStatus === "copying"}
            >
              <Icon name={copyStatus === "copied" ? "check" : "copy"} size={18} />
              {copyStatus === "copying"
                ? "Copying…"
                : copyStatus === "copied"
                  ? "Copy again"
                  : "Copy agent instruction"}
            </Button>
            <p className="small agent-copy-status" role="status">
              {copyStatus === "copied"
                ? "Copied. Paste it into your agent, then come back here."
                : copyStatus === "failed"
                  ? "Copy is unavailable. Select the instruction above and copy it manually."
                  : "Keep these instructions private. They allow one proposal upload for this project."}
            </p>
            <div className="agent-code-meta small">
              <span>{eventTitle} · One proposal</span>
              <span>Expires {expires}</span>
            </div>
          </section>
          <div className="agent-waiting" role="status">
            <Icon name="clock" />
            <div>
              <strong>Waiting for your agent’s proposal</strong>
              <p className="small muted">
                Once it arrives, you can review and edit it before saving.
              </p>
            </div>
          </div>
          <Button variant="quiet" onClick={onCancel} disabled={statusUnavailable}>
            Cancel upload instructions
          </Button>
        </>
      )}
      {(ended || phase === "unavailable") && (
        <section className="agent-panel" aria-labelledby="agent-ended-title">
          <h2 id="agent-ended-title">
            {phase === "unavailable"
              ? "Instructions aren’t available on this device."
              : phase === "expired"
                ? "These upload instructions expired."
                : "Upload instructions cancelled."}
          </h2>
          <p>
            {statusUnavailable
              ? "Check for a received proposal before replacing these instructions."
              : "No proposal was received. Your project stays here; new instructions will use the same project."}
          </p>
          <Button onClick={onRestart} disabled={disabled || statusUnavailable}>
            Create new instructions
          </Button>
        </section>
      )}
      <p className="small muted agent-assurance">
        <Icon name="lock" size={16} /> Only you can approve and save. Nothing is published
        automatically.
      </p>
    </div>
  );
}
