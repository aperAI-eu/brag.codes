"use client";
import { useState } from "react";
import { EventScannerView, type ScannerPhase } from "../../app/src/ui/event-scanner";
import { Button } from "../../app/src/ui/components";
import { normalizePastedEventLink } from "../../app/src/events/event-link";

export function ScannerPreview({
  onContinue,
  onCancel,
}: {
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<ScannerPhase>("idle");
  const [message, setMessage] = useState("");
  const [value, setValue] = useState("");
  return (
    <>
      <EventScannerView
        phase={phase}
        message={message}
        value={value}
        onStart={() => {
          setPhase("scanning");
          setMessage("Camera preview (simulated). Use the sample event below.");
        }}
        onStop={() => {
          setPhase("idle");
          setMessage("Camera stopped. Restart it or paste the event link.");
        }}
        onChange={setValue}
        onResolve={() => {
          setValue("");
          try {
            if (
              normalizePastedEventLink(value, window.location.origin).url ===
              "https://luma.com/sample-event"
            ) {
              onContinue();
              return;
            }
          } catch {
            // Invalid input remains local, just like an unknown catalogue fixture.
          }
          setPhase("error");
          setMessage("This event hasn’t been whitelisted. Use the fictional sample event below.");
        }}
        onCancel={onCancel}
      />
      <aside className="access-card" aria-label="Scanner fixture controls">
        <p className="small muted">
          Catalogue simulation. No camera or network requests. Sample link:
          https://luma.com/sample-event
        </p>
        <Button onClick={onContinue}>Continue to sample event</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setPhase("error");
            setMessage(
              "Camera access was denied. Allow it in your browser settings, or paste the event link below.",
            );
          }}
        >
          Simulate camera denial
        </Button>
      </aside>
    </>
  );
}
