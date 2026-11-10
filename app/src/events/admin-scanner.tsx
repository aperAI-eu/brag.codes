"use client";
import { useEffect, useRef, useState } from "react";
import { EventScannerView, type ScannerPhase } from "../ui/event-scanner";
import { normalizeSource } from "../lib/events/validation";
import { normalizePastedEventLink } from "./event-link";
import { scanCamera } from "./scanner";

export function AdminScanner({
  onResolve,
  onBack,
}: {
  onResolve: (url: string, signal: AbortSignal) => Promise<void>;
  onBack: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const activity = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<ScannerPhase>("idle");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  function stop() {
    activity.current?.abort();
    activity.current = null;
  }
  function pause() {
    stop();
    setPhase("idle");
    setMessage("Camera stopped. Restart it or paste the event link.");
  }
  useEffect(() => {
    const background = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", background);
    window.addEventListener("pagehide", pause);
    window.addEventListener("brag:pause-capture", pause);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", background);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("brag:pause-capture", pause);
    };
  }, []);
  async function resolve(input: string, pasted = false) {
    stop();
    let url: string;
    try {
      url = (pasted ? normalizePastedEventLink : normalizeSource)(input, location.origin).url;
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
    const request = new AbortController();
    activity.current = request;
    const timeout = setTimeout(() => request.abort(), 10000);
    try {
      await onResolve(url, request.signal);
    } catch {
      if (activity.current === request) {
        setPhase("error");
        setMessage(
          "Couldn’t load this event. Check your connection and try again. Nothing was whitelisted.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (activity.current === request) activity.current = null;
    }
  }
  function start() {
    stop();
    const camera = new AbortController();
    activity.current = camera;
    setPhase("requesting");
    setMessage("Waiting for camera permission…");
    void scanCamera(
      video.current!,
      camera.signal,
      () => {
        if (activity.current === camera) {
          setPhase("scanning");
          setMessage("Place the public event QR inside the frame.");
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
            ? "Camera access was denied. Allow it in browser settings, or paste the event link."
            : "Camera unavailable or busy. Close other camera apps, retry, or paste the event link.",
        );
      },
    );
  }
  return (
    <EventScannerView
      purpose="admin"
      phase={phase}
      message={message}
      value={value}
      videoRef={video}
      onStart={start}
      onStop={pause}
      onChange={setValue}
      onResolve={() => void resolve(value, true)}
      onCancel={() => {
        stop();
        onBack();
      }}
    />
  );
}
