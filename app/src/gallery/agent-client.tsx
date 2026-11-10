"use client";
import { useEffect, useRef, useState } from "react";
import { GalleryAgentView, GalleryJsonView } from "../ui/gallery";
import { discoveryPrompt } from "./instructions";
import { galleryReturn } from "./detail-client";
export function GalleryAgentClient({ origin }: { origin: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle"),
    [json, setJson] = useState<string | null>(null),
    [error, setError] = useState("");
  const main = useRef<HTMLElement>(null),
    busy = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    main.current?.focus();
  }, [json]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function example() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      const r = await fetch("/api/v1/projects?limit=2", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error();
      const value = await r.json();
      if (alive.current) setJson(JSON.stringify(value, null, 2));
    } catch {
      if (alive.current) setError("Couldn’t load public JSON. Try again in a moment.");
    } finally {
      busy.current = false;
    }
  }
  return (
    <main className="access-main" tabIndex={-1} ref={main}>
      {json ? (
        <GalleryJsonView value={json} onBack={() => setJson(null)} />
      ) : (
        <GalleryAgentView
          error={error}
          instructions={discoveryPrompt(origin)}
          copied={copied}
          onCopy={() => {
            if (!navigator.clipboard) {
              setCopied("failed");
              return;
            }
            void navigator.clipboard.writeText(discoveryPrompt(origin)).then(
              () => setCopied("copied"),
              () => setCopied("failed"),
            );
          }}
          onBack={() => window.location.assign(galleryReturn())}
          onExample={() => void example()}
        />
      )}
    </main>
  );
}
