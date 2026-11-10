import { useEffect, useRef, useState } from "react";
import type { AgentHandoffControls, AgentPhase } from "../../app/src/ui/agent-handoff";

// Fictional one-proposal inbox. No endpoints, usable credentials or provider calls.
export function useAgentPreview(
  active: boolean,
  reviewing: boolean,
  eventOpen: boolean,
  onComplete: () => void,
  onDuplicate: () => void,
) {
  const [phase, setPhase] = useState<AgentPhase>("waiting");
  const [sequence, setSequence] = useState(12);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [copyStatus, setCopyStatus] = useState<AgentHandoffControls["copyStatus"]>("idle");
  const receipt = useRef(false);
  const [uploaded, setUploaded] = useState(false);
  const generation = useRef(0);
  const current = useRef({ active, eventOpen });
  current.current = { active, eventOpen };
  const ended = phase === "expired" || phase === "cancelled";
  const instruction = `CATALOGUE EXAMPLE — this credential cannot upload.
Read https://example.invalid/skill.md (proposed proposal-upload protocol).
Prepare the full project pitch from the workspace context I authorized, preserving the original language and identifying it. Leave unknown facts empty; exclude source files and secrets.
Upload one proposal using UPLOAD_TOKEN DEMO-UPLOAD-${sequence} in the Authorization header, never in a URL. Keep the same payload and request key if retrying.
I will review, edit and approve it in brag. Do not publish.`;
  const ready =
    active &&
    eventOpen &&
    !ended &&
    !receipt.current &&
    expiresAt !== null &&
    Date.now() < expiresAt;
  const reset = () => {
    generation.current += 1;
    receipt.current = false;
    setUploaded(false);
    setPhase("waiting");
    setSequence((value) => value + 1);
    setExpiresAt(null);
    setStatusUnavailable(false);
    setCopyStatus("idle");
  };
  const complete = () => {
    generation.current += 1;
    setPhase("received");
    setCopyStatus("idle");
    onComplete();
  };
  useEffect(() => {
    if (!active || ended || receipt.current) return;
    if (expiresAt === null) {
      setExpiresAt(Date.now() + 30 * 60_000);
      return;
    }
    const timer = setTimeout(
      () => {
        if (!receipt.current) {
          generation.current += 1;
          setPhase("expired");
          setCopyStatus("idle");
        }
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [active, ended, expiresAt, uploaded]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setCopyStatus("idle");
    }
  }, [active]);
  const view: AgentHandoffControls = {
    phase,
    instruction,
    statusUnavailable,
    copyStatus,
    expires:
      expiresAt === null
        ? "in 30 minutes"
        : new Date(expiresAt).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Prague",
          }) + " · Europe/Prague",
    onCopy: async () => {
      if (!ready || phase !== "waiting" || statusUnavailable || copyStatus === "copying") return;
      const request = generation.current;
      setCopyStatus("copying");
      try {
        await navigator.clipboard.writeText(instruction);
        if (request === generation.current && current.current.active) setCopyStatus("copied");
      } catch {
        if (request === generation.current && current.current.active) setCopyStatus("failed");
      }
    },
    onCancel: () => {
      if (!active || statusUnavailable || receipt.current) return;
      generation.current += 1;
      setPhase("cancelled");
      setCopyStatus("idle");
    },
    onRestart: () => {
      if (
        !active ||
        !eventOpen ||
        (!ended && phase !== "unavailable") ||
        statusUnavailable ||
        receipt.current
      )
        return;
      generation.current += 1;
      setSequence((value) => value + 1);
      setExpiresAt(Date.now() + 30 * 60_000);
      setCopyStatus("idle");
      setPhase("waiting");
    },
    onRetry: () => {
      if (!active) return;
      setStatusUnavailable(false);
      if (receipt.current) complete();
      else if (expiresAt !== null && Date.now() >= expiresAt) setPhase("expired");
    },
  };
  return {
    view,
    reset,
    simulation: {
      visible: active || reviewing,
      canUpload: ready,
      canDuplicate: reviewing && receipt.current,
      canInterrupt: active && !ended && !statusUnavailable,
      canExpire: active && !ended && !receipt.current,
      canForget: ready && phase === "waiting" && !statusUnavailable,
      onForget: () => {
        if (!ready || statusUnavailable || receipt.current) return;
        generation.current += 1;
        setPhase("unavailable");
        setCopyStatus("idle");
      },
      onUpload: () => {
        if (!ready || receipt.current) return;
        receipt.current = true;
        setUploaded(true);
        if (!statusUnavailable) complete();
      },
      onDuplicate: () => {
        if (reviewing && receipt.current) onDuplicate();
      },
      onExpire: () => {
        if (active && !receipt.current) {
          generation.current += 1;
          setExpiresAt(Date.now());
          setPhase("expired");
          setCopyStatus("idle");
        }
      },
      onInterrupt: () => {
        if (active && !ended) setStatusUnavailable(true);
      },
    },
  };
}
