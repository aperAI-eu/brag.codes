"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  InstallationHelpView,
  MobileSupportLink,
  type InstallationState,
} from "../ui/mobile-support";

type InstallEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" } | void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export function MobileProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InstallationState>("manual");
  const prompt = useRef<InstallEvent | null>(null);
  const active = useRef(true),
    attempt = useRef(0);
  const previous = useRef<HTMLElement | null>(null),
    help = useRef<HTMLElement>(null);
  useEffect(() => {
    active.current = true;
    const standalone = matchMedia("(display-mode: standalone)");
    const isStandalone = () =>
      standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const mode = () => {
      if (isStandalone()) {
        attempt.current++;
        prompt.current = null;
        setState("standalone");
      }
    };
    const available = (event: Event) => {
      event.preventDefault();
      if (isStandalone()) return;
      if (typeof (event as InstallEvent).prompt !== "function") return;
      prompt.current = event as InstallEvent;
      setState("available");
    };
    const installed = () => {
      attempt.current++;
      prompt.current = null;
      setState(isStandalone() ? "standalone" : "accepted");
    };
    mode();
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", installed);
    standalone.addEventListener("change", mode);
    // First registration does not take over an already open editor. Updates wait
    // for existing clients to close; no skipWaiting, clients.claim or reload listener.
    if (isSecureContext && "serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    return () => {
      active.current = false;
      attempt.current++;
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
      standalone.removeEventListener("change", mode);
    };
  }, []);
  useEffect(() => {
    if (open) help.current?.focus();
    else previous.current?.focus();
  }, [open]);
  async function install() {
    const event = prompt.current;
    if (!event) return;
    prompt.current = null;
    const id = ++attempt.current;
    setState("prompting");
    try {
      const result = (await event.prompt()) || (await event.userChoice);
      if (!result) throw new Error("Install result unavailable");
      if (active.current && id === attempt.current)
        setState(result.outcome === "accepted" ? "accepted" : "dismissed");
    } catch {
      if (active.current && id === attempt.current) setState("failed");
    }
  }
  return (
    <>
      <div hidden={open}>{children}</div>
      {open ? (
        <main className="access-main" tabIndex={-1} ref={help}>
          <InstallationHelpView
            state={state}
            onInstall={() => void install()}
            onBack={() => setOpen(false)}
          />
        </main>
      ) : (
        <MobileSupportLink
          onOpen={() => {
            previous.current = document.activeElement as HTMLElement;
            window.dispatchEvent(new Event("brag:pause-capture"));
            setOpen(true);
          }}
        />
      )}
    </>
  );
}
