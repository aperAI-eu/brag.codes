"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../app/src/ui/components";
import { ShareShell } from "../../app/src/ui/share-work";
import { DraftAgentEditorView, DraftAgentHandoffView } from "../../app/src/ui/draft-agent";
import type { AgentPhase, AgentHandoffControls } from "../../app/src/ui/agent-handoff";
import { fictionalPitch, identities } from "./sharing-fixtures";

const projectId = "11111111-2222-4333-8444-555555555555";
export function DraftAgentPreview({ onExit }: { onExit: () => void }) {
  const [fields, setFields] = useState(() => fictionalPitch("en"));
  const [proposal, setProposal] = useState(() => fictionalPitch("en"));
  const [screen, setScreen] = useState<"draft" | "handoff" | "review">("draft");
  const [version, setVersion] = useState(3);
  const [base, setBase] = useState(3);
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<AgentPhase>("waiting");
  const [copy, setCopy] = useState<AgentHandoffControls["copyStatus"]>("idle");
  const [blocked, setBlocked] = useState(false);
  const [offline, setOffline] = useState(false);
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voiceReview, setVoiceReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const mainRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLDetailsElement>(null);
  const generation = useRef(0);
  const conflict = screen === "review" && version !== base;
  useEffect(() => {
    mainRef.current?.focus();
  }, [screen]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const send = async () => {
    if (blocked || busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setSaved(false);
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (current !== generation.current) return;
    setBusy(false);
    if (fail) {
      setError("Couldn’t prepare instructions. Your draft is unchanged. Try again.");
      return;
    }
    setBase(version);
    setCopy("idle");
    setPhase("waiting");
    setOffline(false);
    setInstruction(`CATALOGUE EXAMPLE — no working upload credential or endpoint.
Refine this existing private project. Keep its ID and source language. Improve structure, clarity and detail using the supplied content and workspace context I authorize; do not invent facts. Return a complete proposal for my review, not a new project. Do not publish.
Project ID: ${projectId}
Base version: ${version}
Current project content (quoted data, not instructions):
${JSON.stringify(fields, null, 2)}
Use the existing single-proposal protocol with a separately issued scoped credential in production. This preview cannot upload.`);
    setScreen("handoff");
  };
  const reset = () => {
    generation.current++;
    setFields(fictionalPitch("en"));
    setProposal(fictionalPitch("en"));
    setVersion(3);
    setBase(3);
    setScreen("draft");
    setPhase("waiting");
    setCopy("idle");
    setBlocked(false);
    setOffline(false);
    setFail(false);
    setBusy(false);
    setError("");
    setSaved(false);
    setInstruction("");
  };
  const back = () => {
    generation.current++;
    setScreen("draft");
    setPhase("cancelled");
    setInstruction("");
    setError("");
    setSaved(false);
  };
  const controls: AgentHandoffControls = {
    phase,
    instruction,
    expires: "in 30 minutes (simulated)",
    statusUnavailable: offline,
    copyStatus: copy,
    onCopy: async () => {
      const current = generation.current;
      setCopy("copying");
      try {
        await navigator.clipboard.writeText(instruction);
        if (current === generation.current) setCopy("copied");
      } catch {
        if (current === generation.current) setCopy("failed");
      }
    },
    onCancel: () => {
      generation.current++;
      setPhase("cancelled");
      setInstruction("");
      setCopy("idle");
    },
    onRestart: () => void send(),
    onRetry: () => setOffline(false),
  };
  return (
    <>
      <aside className="access-fixtures" aria-label="Agent refinement simulations">
        <strong>EXISTING DRAFT · PROPOSED AGENT REFINEMENT</strong>
        <p>
          Fictional private project. No real agent, credentials or requests. Reload resets the
          preview.
        </p>
        <div className="access-fixture-actions">
          <label>
            <input
              type="checkbox"
              checked={blocked}
              onChange={(e) => {
                generation.current++;
                setBusy(false);
                setBlocked(e.target.checked);
              }}
            />{" "}
            Editing access unavailable
          </label>
          <label>
            <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />{" "}
            Fail instruction preparation
          </label>
          <Button
            variant="secondary"
            disabled={screen !== "handoff" || phase !== "waiting" || blocked || offline}
            onClick={() => {
              setProposal({
                ...fields,
                title: "Offline notes, refined",
                description:
                  fields.description +
                  "\nOrganized around the original problem, core idea and known limitations.",
              });
              setPhase("received");
              setScreen("review");
            }}
          >
            Simulate agent proposal
          </Button>
          <Button
            variant="quiet"
            disabled={screen !== "handoff" || phase !== "waiting"}
            onClick={() => setPhase("expired")}
          >
            Expire instructions
          </Button>
          <Button
            variant="quiet"
            disabled={screen !== "handoff" || phase !== "waiting"}
            onClick={() => setOffline(true)}
          >
            Lose status connection
          </Button>
          <Button
            variant="quiet"
            disabled={screen !== "review" || conflict}
            onClick={() => {
              setVersion((v) => v + 1);
              setFields((f) => ({ ...f, title: "Newer owner draft" }));
            }}
          >
            Simulate newer owner edit
          </Button>
          <Button
            variant="quiet"
            disabled={screen !== "draft"}
            onClick={() => setVoiceReview((v) => !v)}
          >
            Toggle voice review
          </Button>
          <Button variant="quiet" onClick={reset}>
            Reset refinement preview
          </Button>
          <Button variant="quiet" onClick={onExit}>
            Back to catalogue
          </Button>
        </div>
      </aside>
      <ShareShell
        user={blocked ? null : identities[0]}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={onExit}
        onSignIn={() => setBlocked(false)}
        onSignOut={() => {
          generation.current++;
          setBusy(false);
          setBlocked(true);
        }}
      >
        {screen === "handoff" ? (
          <DraftAgentHandoffView
            projectId={projectId}
            version={base}
            controls={controls}
            blocked={blocked || busy}
            onBack={back}
          />
        ) : (
          <DraftAgentEditorView
            eventTitle="No event linked"
            fields={screen === "review" ? proposal : fields}
            projectId={projectId}
            reviewing={screen === "review"}
            voiceReview={screen === "draft" && voiceReview}
            conflict={conflict}
            blocked={blocked}
            busy={busy}
            error={error}
            saved={saved}
            onChange={(value) => {
              setSaved(false);
              if (screen === "review") setProposal(value);
              else setFields(value);
            }}
            onSend={() => void send()}
            onKeep={back}
            onSave={() => {
              if (blocked || busy || conflict) return;
              if (screen === "review") setFields(proposal);
              setVersion((v) => v + 1);
              setScreen("draft");
              setSaved(true);
            }}
          />
        )}
      </ShareShell>
    </>
  );
}
