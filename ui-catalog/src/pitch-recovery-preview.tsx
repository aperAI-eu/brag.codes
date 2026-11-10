"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../app/src/ui/components";
import {
  PitchRecoveryView,
  PitchRecoveryEditorView,
  type PitchRecoveryState,
} from "../../app/src/ui/pitch-recovery";
import { ShareShell, ShareMessageView } from "../../app/src/ui/share-work";
import { emptyProject } from "../../app/src/projects/model";
import { fictionalPitch, identities } from "./sharing-fixtures";

export function PitchRecoveryPreview({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<PitchRecoveryState>("configuration");
  const [blocked, setBlocked] = useState<"" | "closed" | "suspended" | "session">("");
  const [screen, setScreen] = useState("recovery");
  const [confirming, setConfirming] = useState(false);
  const [fail, setFail] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState(() => fictionalPitch("en"));
  const retrySource = useRef<"ready" | "transcript">("ready");
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    mainRef.current?.focus();
  }, [screen, state]);
  useEffect(() => {
    if (state !== "processing") return;
    const timer = setTimeout(() => {
      if (fail) {
        setState(retrySource.current);
        setError(
          retrySource.current === "ready"
            ? "The attempt failed. Your recording is still retained until the original expiry."
            : "Draft preparation failed. Your transcript is still available.",
        );
      } else {
        setState("transcript");
        setScreen("editor");
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [state, fail]);
  const reset = () => {
    setState("configuration");
    setBlocked("");
    setScreen("recovery");
    setConfirming(false);
    setFail(false);
    setError("");
    setFields(fictionalPitch("en"));
  };
  return (
    <>
      <aside className="access-fixtures" aria-label="Recording recovery simulations">
        <strong>RECORDING RECOVERY · PROPOSED PREVIEW</strong>
        <p>
          Fictional received pitch. No audio, account, provider calls or storage. Proposed
          retention: 24 hours from receipt. Reload resets this preview.
        </p>
        <div className="access-fixture-actions">
          <label>
            Recovery scenario{" "}
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value as PitchRecoveryState);
                setScreen("recovery");
                setConfirming(false);
                setError("");
              }}
            >
              <option value="configuration">Configuration needs attention</option>
              <option value="ready">Configuration corrected</option>
              <option value="unavailable">Retry unavailable or limit reached</option>
              <option value="uncertain">Provider receipt uncertain</option>
              <option value="expired">Recording expired or unavailable</option>
              <option value="transcript">Transcript retained</option>
            </select>
          </label>
          <label>
            Access scenario{" "}
            <select
              value={blocked}
              onChange={(e) => {
                setBlocked(e.target.value as typeof blocked);
                setConfirming(false);
              }}
            >
              <option value="">Open event, owner signed in</option>
              <option value="closed">Event closed</option>
              <option value="suspended">Event suspended</option>
              <option value="session">Session expired</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
            Fail recovery attempt
          </label>
          <Button variant="quiet" onClick={reset}>
            Reset recovery preview
          </Button>
          <Button variant="quiet" onClick={onExit}>
            Back to catalogue
          </Button>
        </div>
      </aside>
      <ShareShell
        user={blocked === "session" ? null : identities[0]}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={onExit}
        onSignIn={() => setBlocked("")}
        onSignOut={() => {
          setBlocked("session");
          setScreen("recovery");
        }}
      >
        {screen === "recovery" ? (
          <PitchRecoveryView
            state={state}
            eventTitle="Bratislava Demo Night"
            processingAudio={retrySource.current === "ready"}
            blocked={blocked}
            expires="10 November 2026, 18:30 Prague time"
            error={error}
            confirming={confirming}
            onRetry={() => {
              if (!blocked && ["ready", "transcript"].includes(state)) {
                retrySource.current = state as "ready" | "transcript";
                setError("");
                setState("processing");
              }
            }}
            onDiscard={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              setState("discarded");
            }}
            onType={() => {
              if (state !== "transcript") setFields(structuredClone(emptyProject));
              setScreen("editor");
            }}
          />
        ) : screen === "editor" ? (
          <PitchRecoveryEditorView
            fields={fields}
            onChange={setFields}
            blocked={!!blocked}
            onSave={() => setScreen("saved")}
          />
        ) : (
          <ShareMessageView
            title="Draft saved."
            message="Your reviewed project is saved in this fictional preview only."
            onHome={reset}
          />
        )}
      </ShareShell>
    </>
  );
}
