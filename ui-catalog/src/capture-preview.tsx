"use client";
import { useEffect, useState } from "react";
import { PitchProgress } from "../../app/src/ui/pitch-progress";
import { Button } from "../../app/src/ui/components";
import { CaptureChoices, ProjectEditor } from "../../app/src/ui/project-capture";
import { emptyProject, type ProjectFields } from "../../app/src/projects/model";
export function CapturePreview() {
  const [method, setMethod] = useState<"choice" | "typed" | "voice" | "agent">("choice");
  const [fields, setFields] = useState<ProjectFields>(() => structuredClone(emptyProject));
  const [drafts, setDrafts] = useState<{ id: string; fields: ProjectFields }[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState<
    "idle" | "recording" | "transcribing" | "structuring" | "review"
  >("idle");
  const [voiceReview, setVoiceReview] = useState(false);
  const voiceLocked = (step !== "idle" || voiceReview) && !saved;
  useEffect(() => {
    if (step !== "transcribing" && step !== "structuring") return;
    const timer = setTimeout(
      () => setStep(step === "transcribing" ? "structuring" : "review"),
      700,
    );
    return () => clearTimeout(timer);
  }, [step]);
  const save = () => {
    const nextId = id || crypto.randomUUID();
    setDrafts((rows) => [
      { id: nextId, fields: structuredClone(fields) },
      ...rows.filter((row) => row.id !== nextId),
    ]);
    setId(nextId);
    setSaved(true);
  };
  return (
    <section className="access-card admin-flow capture-card">
      <p className="eyebrow">Sample demo night · Private project capture</p>
      {method !== "choice" && !voiceLocked && (
        <Button variant="quiet" onClick={() => setMethod("choice")}>
          Other ways to share
        </Button>
      )}
      {method === "choice" && <CaptureChoices onChoose={setMethod} />}
      {method === "typed" && (
        <>
          <h1>Tell us what you built.</h1>
          <ProjectEditor
            value={fields}
            onChange={(value) => {
              setFields(value);
              setSaved(false);
            }}
          />
          {voiceReview && <PitchProgress stage={saved ? "saved" : "review"} />}
          <Button onClick={save}>
            {voiceReview && !saved ? "Approve and save draft" : "Save draft"}
          </Button>
          {saved && <p role="status">Private draft saved in this preview</p>}
        </>
      )}
      {method === "voice" && (
        <>
          <h1>Your 20-second pitch.</h1>
          <p>
            The real app records up to 20 seconds, then uses Distill and Claude. This preview uses
            fictional text and makes no provider calls.
          </p>
          {step === "idle" && (
            <Button
              onClick={() => {
                setSaved(false);
                setStep("recording");
              }}
            >
              Start recording preview
            </Button>
          )}
          {step === "recording" && (
            <>
              <p role="status">
                Recording preview · 20-second maximum. Stop or the limit starts processing.
              </p>
              <Button onClick={() => setStep("transcribing")}>■ Stop and process</Button>
              <Button variant="quiet" onClick={() => setStep("transcribing")}>
                Simulate 20-second limit
              </Button>
            </>
          )}
          {["transcribing", "structuring", "review"].includes(step) && (
            <PitchProgress stage={step as "transcribing" | "structuring" | "review"} />
          )}
          {step === "review" && (
            <Button
              onClick={() => {
                setFields({
                  ...fields,
                  language: "en",
                  title: "Offline notes",
                  problem: "Find my notes without internet",
                  description: "A local searchable notebook.",
                  details: {
                    ...structuredClone(emptyProject.details),
                    core_idea: "Keep a searchable notebook on the device",
                    capabilities: ["Search notes offline"],
                    stack: ["TypeScript"],
                    reality_level: "prototype",
                    patterns: [
                      {
                        id: crypto.randomUUID(),
                        kind: "system",
                        name: "Local search index",
                        description: "Notes are indexed on the device",
                        evidence: "The sample speaker describes offline search",
                        source: "author_reported",
                      },
                    ],
                  },
                });
                setSaved(false);
                setVoiceReview(true);
                setMethod("typed");
              }}
            >
              Use this text and edit
            </Button>
          )}
        </>
      )}
      {method === "agent" && (
        <>
          <h1>Use your AI agent.</h1>
          <p>
            Save a private draft, then approve a request from your agent for this project. Live
            credentials and approval are available in the real app.
          </p>
          <Button onClick={() => setMethod("typed")}>Review project fields</Button>
        </>
      )}
      {method !== "choice" && (
        <Button
          variant="secondary"
          disabled={voiceLocked}
          onClick={() => {
            save();
            setId(null);
            setFields(structuredClone(emptyProject));
            setSaved(false);
            setStep("idle");
            setVoiceReview(false);
            setMethod("choice");
          }}
        >
          Save and start another project
        </Button>
      )}
      {method === "choice" && drafts.length > 0 && (
        <section aria-label="Your private drafts">
          <h2>Your private drafts</h2>
          <ul className="draft-list">
            {drafts.map((row) => (
              <li key={row.id}>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setId(row.id);
                    setFields(structuredClone(row.fields));
                    setSaved(true);
                    setMethod("typed");
                  }}
                >
                  {row.fields.title || "Untitled project"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
