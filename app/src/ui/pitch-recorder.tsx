import { Button } from "./components";

export type PitchRecorderControls = {
  seconds: number;
  soundEnabled: boolean;
  onSoundChange: (enabled: boolean) => void;
  onRecord: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
};

export function PitchRecorderView({
  phase,
  disabled,
  seconds,
  soundEnabled,
  onSoundChange,
  onRecord,
  onPause,
  onResume,
  onFinish,
}: PitchRecorderControls & {
  phase: "voice" | "recording" | "paused";
  disabled: boolean;
}) {
  const idle = phase === "voice";
  const recording = phase === "recording";
  const warning = seconds >= 25;
  const action = idle ? "Start recording" : recording ? "Pause recording" : "Resume recording";
  return (
    <div className="pitch-recorder">
      <h1>{idle ? "Your 30-second pitch." : recording ? "Make your pitch." : "Take a breath."}</h1>
      <p className="muted">
        {idle
          ? "What problem did you solve? What did you build? What makes it interesting?"
          : recording
            ? "Pause whenever you need a moment."
            : "Your pitch is paused. Resume, or finish and prepare your draft."}
      </p>
      <div className={`pitch-recorder-clock${warning ? " is-near-limit" : ""}`}>
        <p role="status" className="pitch-recorder-status">
          {idle ? "Ready when you are" : recording ? "Recording" : "Paused · timer stopped"}
        </p>
        <p role="timer" aria-label={`${seconds} of 30 seconds recorded`}>
          <strong>00:{String(seconds).padStart(2, "0")}</strong> <span>/ 00:30</span>
        </p>
        <progress value={seconds} max={30} aria-label="Recording time" />
        <p className="small muted">{30 - seconds} seconds left · pauses don’t count</p>
        <p className="pitch-recorder-warning" role="status">
          {warning ? "Almost there — wrap up your pitch." : "We’ll remind you with 5 seconds left."}
        </p>
      </div>
      <div className="pitch-recorder-actions">
        <Button
          variant="quiet"
          className={`pitch-recorder-control ${recording ? "is-recording" : ""}`}
          aria-label={action}
          disabled={!recording && disabled}
          onClick={idle ? onRecord : recording ? onPause : onResume}
        >
          <span
            className={`pitch-recorder-symbol ${recording ? "is-pause" : "is-record"}`}
            aria-hidden="true"
          />
        </Button>
        <span className="pitch-recorder-label" aria-hidden="true">
          {action}
        </span>
        {phase === "paused" && (
          <Button variant="secondary" onClick={onFinish}>
            <span className="pitch-recorder-stop" aria-hidden="true" /> Finish pitch
          </Button>
        )}
      </div>
      <label className="pitch-recorder-sound">
        <input
          type="checkbox"
          checked={soundEnabled}
          onChange={(e) => onSoundChange(e.target.checked)}
        />
        Play a short beep at 25 seconds
      </label>
      <p className="small muted">
        We’ll also try a vibration. Sound and vibration depend on your device; a beep may be heard
        in your recording.
      </p>
      <p className="small muted">
        Finish pitch or the 30-second limit sends your pitch to Distill, then Claude prepares your
        draft. Review, approve and save before recording another project. Received audio stays
        private for up to 24 hours so you can recover a failed pitch. We remove it after
        transcription succeeds, when you discard it, or when it expires.
      </p>
    </div>
  );
}
