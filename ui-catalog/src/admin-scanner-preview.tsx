"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../app/src/ui/components";
import { EventScannerView, type ScannerPhase } from "../../app/src/ui/event-scanner";
import { normalizePastedEventLink } from "../../app/src/events/event-link";
import { exampleLink, existingLink, fixtureLink } from "./admin-fixtures";

export function AdminScannerPreview({
  onResolve,
  onBack,
}: {
  onResolve: (url: string) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<ScannerPhase>("idle");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const stop = () => {
    clearTimeout(timer.current);
    setPhase("idle");
    setMessage("Camera stopped. Restart it or paste the event link.");
  };
  useEffect(() => {
    const background = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", background);
    return () => document.removeEventListener("visibilitychange", background);
  }, []);
  function resolve(input: string) {
    clearTimeout(timer.current);
    let url: string;
    try {
      url = normalizePastedEventLink(input, window.location.origin).url;
    } catch {
      setValue("");
      setPhase("error");
      setMessage(
        "That code isn’t a supported public event link. Use the event’s public QR, not a ticket.",
      );
      return;
    }
    setValue(url);
    setPhase("resolving");
    setMessage("Loading event details for your review…");
    timer.current = setTimeout(() => {
      if (offline) {
        setPhase("error");
        setMessage(
          "Couldn’t load this event. Check your connection and try again. Nothing was whitelisted.",
        );
      } else if (!fixtureLink(url)) {
        setPhase("error");
        setMessage("This preview only knows its two fictional events. Use an example link below.");
      } else onResolve(url);
    }, 350);
  }
  const cameraError = (text: string) => {
    clearTimeout(timer.current);
    setPhase("error");
    setMessage(text);
  };
  return (
    <>
      <EventScannerView
        purpose="admin"
        phase={phase}
        value={value}
        message={message}
        onChange={setValue}
        onCancel={onBack}
        onStop={stop}
        onResolve={() => resolve(value)}
        onStart={() => {
          setPhase("requesting");
          setMessage("Waiting for camera permission…");
        }}
      />
      <details className="access-card" open>
        <summary>Fictional camera controls</summary>
        <p className="small muted">
          No camera or network is used. New event: {exampleLink}. Existing event: {existingLink}.
        </p>
        <div className="share-shortcuts">
          <Button
            variant="secondary"
            disabled={phase !== "requesting"}
            onClick={() => {
              setPhase("scanning");
              setMessage("Place the public event QR inside the frame (simulated).");
            }}
          >
            Allow camera
          </Button>
          <Button
            variant="secondary"
            disabled={phase !== "scanning"}
            onClick={() => resolve(exampleLink)}
          >
            Decode new event QR
          </Button>
          <Button
            variant="secondary"
            disabled={phase !== "scanning"}
            onClick={() => resolve(existingLink)}
          >
            Decode existing event QR
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              cameraError(
                "Camera access was denied. Allow it in browser settings, or paste the event link.",
              )
            }
          >
            Deny camera
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              cameraError(
                "Camera unavailable or busy. Close other camera apps, retry, or paste the event link.",
              )
            }
          >
            Camera unavailable
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              resolve("https://luma.com/example-demo-night?ticket=fictional-private-token")
            }
          >
            Decode ticket QR
          </Button>
          <Button variant="secondary" onClick={stop}>
            Background app
          </Button>
          <Button variant="secondary" onClick={() => setOffline(!offline)}>
            {offline ? "Restore connection" : "Lose connection"}
          </Button>
        </div>
        <p role="status">Fixture connection: {offline ? "offline" : "online"}</p>
      </details>
    </>
  );
}
