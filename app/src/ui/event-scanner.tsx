import type { RefObject } from "react";
import { Button, Field, Icon, TextInput } from "./components";

export type ScannerPhase = "idle" | "requesting" | "scanning" | "resolving" | "error";

export function EventScannerView({
  purpose = "attendee",
  phase,
  message,
  value,
  videoRef,
  onStart,
  onStop,
  onChange,
  onResolve,
  onCancel,
  onWithoutEvent,
}: {
  purpose?: "attendee" | "admin";
  phase: ScannerPhase;
  message: string;
  value: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onStart: () => void;
  onStop: () => void;
  onChange: (value: string) => void;
  onResolve: () => void;
  onCancel: () => void;
  onWithoutEvent?: () => void;
}) {
  const camera = phase === "requesting" || phase === "scanning";
  return (
    <section className="access-card event-scanner">
      <Button variant="quiet" onClick={onCancel}>
        <Icon name="back" size={18} /> {purpose === "admin" ? "Back to events" : "Back to brag"}
      </Button>
      <p className="eyebrow">{purpose === "admin" ? "ADD AN EVENT · 1 OF 2" : "FIND YOUR EVENT"}</p>
      <h1>Scan the event QR.</h1>
      <p className="muted">
        {purpose === "admin"
          ? "Use the event’s public link. You’ll review the details before whitelisting it."
          : "Use the event’s public QR code to start sharing your project."}
      </p>
      <div className="event-camera" hidden={!camera}>
        <video ref={videoRef} muted playsInline autoPlay aria-label="Event QR camera preview" />
      </div>
      <p
        role={phase === "error" ? "alert" : "status"}
        className={phase === "error" ? "access-error" : "small muted"}
      >
        {message || "Camera images stay on your device."}
      </p>
      {camera ? (
        <Button variant="secondary" onClick={onStop}>
          Stop camera
        </Button>
      ) : (
        <Button onClick={onStart} disabled={phase === "resolving"}>
          <Icon name="grid" size={20} /> Start camera
        </Button>
      )}
      {purpose === "attendee" && onWithoutEvent && (
        <Button variant="secondary" onClick={onWithoutEvent}>
          Continue without an event
        </Button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onResolve();
        }}
      >
        <Field label="Or paste the event link" htmlFor="event-link">
          <TextInput
            id="event-link"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={2048}
            placeholder="luma.com/your-event"
            aria-describedby="event-link-help"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={phase === "resolving"}
            required
          />
        </Field>
        <p id="event-link-help" className="small muted">
          https:// is optional when pasting a link.
        </p>
        <Button type="submit" variant="secondary" disabled={!value.trim() || phase === "resolving"}>
          {phase === "resolving"
            ? "Finding event…"
            : purpose === "admin"
              ? "Review event link"
              : "Find event"}
        </Button>
      </form>
      <p className="small muted">
        Luma, Meetup, Eventbrite or a brag event link. Use the public event code, not a personal
        ticket.
      </p>
    </section>
  );
}
