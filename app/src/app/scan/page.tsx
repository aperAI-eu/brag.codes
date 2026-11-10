"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "../account-shell";
import { EventLinkedView } from "../../ui/share-work";
import { eventView } from "../../sharing/presentation";
import type { EventSummary } from "../../lib/sharing/queries";
import { scanCamera } from "../../events/scanner";
import { normalizePastedEventLink } from "../../events/event-link";
import { normalizeSource, uuid } from "../../lib/events/validation";
import { EventScannerView, type ScannerPhase } from "../../ui/event-scanner";

const unsupported =
  "This QR isn’t a supported public event link. Try the event’s public QR or paste its link.";
const messages: Record<string, string> = {
  unsupported_event_url: unsupported,
  invalid_request: unsupported,
  event_unavailable:
    "This event hasn’t been whitelisted or is no longer available. Ask the organizer, or try another event link.",
  rate_limited: "Too many attempts. Wait one minute, then try again.",
};

export default function Scan() {
  const { account, loading } = useAccount();
  const [linked, setLinked] = useState<{ event: EventSummary; already_linked: boolean } | null>(
    null,
  );
  const pending = useRef<{ intent: string; key: string } | null>(null);
  useEffect(() => {
    if (!loading && !account) window.location.replace("/sign-in?return_to=%2Fscan");
  }, [account, loading]);
  const video = useRef<HTMLVideoElement>(null);
  const activity = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<ScannerPhase>("idle");
  const [message, setMessage] = useState("");
  const [value, setValue] = useState("");
  function stop() {
    activity.current?.abort();
    activity.current = null;
  }
  useEffect(() => {
    const pause = () => {
      if (!activity.current) return;
      stop();
      setPhase("idle");
      setMessage("Scanning paused. Start the camera or paste the event link to continue.");
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") pause();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("brag:pause-capture", pause);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("brag:pause-capture", pause);
    };
  }, []);
  async function resolve(text: string, pasted = false) {
    stop();
    setValue("");
    // Share the server's allowlist: ticket contents and arbitrary URLs never leave this device.
    let url: string;
    try {
      url = (pasted ? normalizePastedEventLink : normalizeSource)(text, window.location.origin).url;
    } catch {
      setPhase("error");
      setMessage(unsupported);
      return;
    }
    const intent = JSON.stringify([url, pasted]);
    if (pending.current?.intent !== intent) pending.current = { intent, key: crypto.randomUUID() };
    const request = new AbortController();
    activity.current = request;
    setPhase("resolving");
    setMessage("Finding your event…");
    const timeout = setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch("/api/v1/me/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current!.key },
        body: JSON.stringify({ url, entry_method: pasted ? "pasted_url" : "qr_scan" }),
        cache: "no-store",
        signal: request.signal,
      });
      const data = await response.json();
      if (activity.current !== request || request.signal.aborted) return;
      if (!response.ok) {
        setPhase("error");
        setMessage(messages[data.error?.code] || "Couldn’t check the event. Please try again.");
        return;
      }
      if (!uuid(data.event?.id)) throw new Error();
      // Build the local route from the resolved ID; never navigate to the scanned URL.
      setLinked(data);
      pending.current = null;
    } catch {
      if (activity.current !== request) return;
      setPhase("error");
      setMessage(
        "Couldn’t connect to brag. Check your connection, then scan or paste the link again.",
      );
    } finally {
      clearTimeout(timeout);
      if (activity.current === request) activity.current = null;
    }
  }
  function start() {
    stop();
    const camera = new AbortController();
    activity.current = camera;
    setMessage("Allow camera access to scan the event QR.");
    setPhase("requesting");
    setValue("");
    void scanCamera(
      video.current!,
      camera.signal,
      () => {
        if (activity.current === camera) {
          setPhase("scanning");
          setMessage("Point your camera at the event QR.");
        }
      },
      (text) => {
        if (activity.current === camera) void resolve(text);
      },
      (error) => {
        if (activity.current !== camera) return;
        activity.current = null;
        setPhase("error");
        setMessage(
          error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)
            ? "Camera access was denied. Allow it in your browser settings, or paste the event link below."
            : "The camera is unavailable or busy. Try again, or paste the event link below.",
        );
      },
    );
  }
  if (!account)
    return (
      <main className="access-main">
        <p>Checking your identity…</p>
      </main>
    );
  if (linked)
    return (
      <main className="access-main">
        <EventLinkedView
          event={eventView(linked.event)}
          repeated={linked.already_linked}
          onContinue={() => window.location.assign(`/events/${linked.event.id}/submit`)}
          onScan={() => {
            setLinked(null);
            setPhase("idle");
          }}
          onHome={() => window.location.assign("/")}
        />
      </main>
    );
  return (
    <main className="access-main">
      <EventScannerView
        phase={phase}
        message={message}
        value={value}
        videoRef={video}
        onStart={start}
        onStop={() => {
          stop();
          setPhase("idle");
          setMessage("Camera stopped. Restart it or paste the event link.");
        }}
        onChange={setValue}
        onResolve={() => void resolve(value, true)}
        onWithoutEvent={() => {
          stop();
          window.location.assign("/submit");
        }}
        onCancel={() => {
          stop();
          window.location.assign("/");
        }}
      />
    </main>
  );
}
