import { useEffect, useRef, useState } from "react";
import type { AccountSummary } from "../../app/src/ui/access";
import type { LinkedEvent } from "../../app/src/ui/share-work";
import type { CaptureStage } from "../../app/src/ui/share-capture";
import { emptyProject, type ProjectFields } from "../../app/src/projects/model";
import { useRecordingPreview } from "./use-recording-preview";
import { useAgentPreview } from "./use-agent-preview";
import { fictionalPitch, type StoredProject } from "./sharing-fixtures";

// In-memory job simulation. Production operations and provider transport are never imported.
export function usePitchPreview(
  user: AccountSummary | null,
  event: LinkedEvent | undefined,
  onSaved: (project: StoredProject) => void,
  visible: boolean,
) {
  const [stage, setStage] = useState<CaptureStage>("choice");
  const [fields, setFields] = useState<ProjectFields>(() => structuredClone(emptyProject));
  const [retained, setRetained] = useState(false);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [saved, setSaved] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [received, setReceived] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [loadedResult, setLoadedResult] = useState(false);
  const readOnly = event?.state === "suspended";
  const canSave =
    !!user &&
    !!event &&
    !readOnly &&
    !upgradeRequired &&
    (saved || (received && stage === "proposal") || (event.state === "open" && stage === "typed"));
  const [draftId, setDraftId] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState("");
  const [language, setLanguage] = useState<"sk" | "cs" | "en">("sk");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agentReview, setAgentReview] = useState(false);
  const failSave = useRef(false);
  const saveRequest = useRef<{
    ownerId: string;
    eventId: string;
    id: string;
    fields: ProjectFields;
    completion: boolean;
  } | null>(null);
  const generation = useRef(0);
  const latest = useRef({ user, event, onSaved });
  latest.current = { user, event, onSaved };
  const clearCapture = () => {
    generation.current += 1;
    setFields(structuredClone(emptyProject));
    setStage("choice");
    setDraftId(null);
    setRetained(false);
    setUpgradeRequired(false);
    setSaved(false);
    setLegacy(false);
    setReceived(false);
    setTranscript("");
    setLoadedResult(false);
    setBusy(false);
    setError("");
    recorder.reset();
    agent.reset();
    setAgentReview(false);
    setFinishReason("");
    saveRequest.current = null;
    failSave.current = false;
  };
  const stop = (reason: "finished" | "limit" = "finished") => {
    setAgentReview(false);
    setFinishReason(
      reason === "limit"
        ? "30-second limit reached. Preparing your pitch…"
        : "Pitch finished. Preparing your draft…",
    );
    if (!latest.current.user || latest.current.event?.state !== "open") {
      setError(
        "This event is no longer accepting uploads. Your recording is retained in this preview.",
      );
      setStage("held");
      return;
    }
    setError("");
    setReceived(true);
    setStage("transcribing");
  };
  const recorder = useRecordingPreview(
    stage,
    setStage,
    !!user && visible,
    event?.state === "open",
    stop,
  );
  const agent = useAgentPreview(
    stage === "agent" && !!user && visible,
    stage === "proposal" && agentReview && !!user && visible,
    event?.state === "open",
    () => {
      setFields((current) => ({
        ...fictionalPitch(language),
        project_url: current.project_url,
        repository_url: current.repository_url,
      }));
      setReceived(true);
      setAgentReview(true);
      setStage("proposal");
    },
    () =>
      setError(
        "This proposal was already received. Another upload cannot replace your review or edits.",
      ),
  );
  useEffect(() => {
    if ((stage !== "transcribing" && stage !== "structuring") || !user || upgradeRequired) return;
    const timer = setTimeout(() => {
      if (stage === "transcribing") setStage("structuring");
      else {
        if (!loadedResult)
          setFields((current) => ({
            ...fictionalPitch(language),
            project_url: current.project_url,
            repository_url: current.repository_url,
          }));
        setStage("proposal");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [stage, user, language, loadedResult, upgradeRequired]);
  useEffect(() => {
    if (!busy || !saveRequest.current) return;
    const request = saveRequest.current,
      version = generation.current;
    const timer = setTimeout(() => {
      if (generation.current !== version) return;
      const live = latest.current;
      setBusy(false);
      if (live.user?.id !== request.ownerId) {
        setError("Sign in again before saving. Your text is retained in this tab.");
        return;
      }
      if (
        live.event?.id !== request.eventId ||
        live.event.state === "suspended" ||
        (live.event.state !== "open" && !request.completion)
      ) {
        setError(
          live.event?.state === "suspended"
            ? "The event was suspended before this save. Your unsaved text is retained."
            : "The submission window closed before this save. Nothing new was uploaded; your text is retained.",
        );
        return;
      }
      if (failSave.current) {
        failSave.current = false;
        setError("Save failed. Your text is retained; please try saving again.");
        return;
      }
      live.onSaved({
        ...request,
        title: request.fields.title,
        saved: true,
        unfinished: false,
        status: "Confirmed",
        method: agentReview ? "Agent" : received ? "Voice" : "Typed",
        updated: "just now",
        fields: structuredClone(request.fields),
      });
      setDraftId(request.id);
      setRetained(false);
      setSaved(true);
      setStage("saved");
      setError("");
    }, 450);
    return () => clearTimeout(timer);
  }, [busy]);
  const save = () => {
    if (busy || !canSave || !user || !event) return;
    const id = draftId ?? crypto.randomUUID();
    setDraftId(id);
    saveRequest.current = {
      ownerId: user.id,
      eventId: event.id,
      id,
      fields: structuredClone(fields),
      completion: saved || (received && stage === "proposal"),
    };
    setError("");
    setBusy(true);
  };
  return {
    stage,
    setStage,
    fields,
    setFields,
    retained,
    setRetained,
    readOnly,
    saved,
    legacy,
    canSave,
    upgradeRequired,
    requireUpgrade: () => {
      generation.current += 1;
      setBusy(false);
      saveRequest.current = null;
      setUpgradeRequired(true);
    },
    transcript,
    draftId,
    loadProject: (project: StoredProject) => {
      clearCapture();
      setDraftId(project.id);
      setFields(structuredClone(project.fields));
      setSaved(project.saved);
      setLegacy(!!project.legacy);
      setReceived(!!project.received);
      setTranscript(project.transcript ?? "");
      setLoadedResult(true);
      setAgentReview(project.method === "Agent");
      setStage(
        project.recovery === "failed"
          ? "failed"
          : project.recovery === "preparing"
            ? "transcribing"
            : project.recovery === "ready"
              ? "proposal"
              : "typed",
      );
      setRetained(project.unfinished);
    },
    retry: () => {
      if (user && event?.state === "open") {
        setReceived(true);
        setStage("transcribing");
      }
    },
    failProcessing: () => {
      if (stage !== "transcribing" && stage !== "structuring") return;
      setReceived(false);
      setTranscript("I built a workshop booking tool for our community.");
      if (saved) {
        setError("The new pitch failed. Your saved version is unchanged and remains editable.");
        setStage("typed");
      } else setStage("failed");
    },
    rejectAgentWrite: () => {
      if (saved)
        setError(
          "Those upload instructions are no longer valid. Your saved fields were not changed. Edit this form yourself, or start a separate project for your agent.",
        );
    },
    recorder,
    agent,
    agentReview,
    finishReason,
    language,
    setLanguage,
    busy,
    error,
    clearCapture,
    save,
    stop,
    failNextSave: () => {
      failSave.current = true;
    },
  };
}
