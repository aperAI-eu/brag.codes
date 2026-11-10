import { useState } from "react";
import { BrandLogo } from "../../app/src/ui/brand";
import { Button } from "../../app/src/ui/components";
import { EventChoiceView } from "../../app/src/ui/event-choice";
import { EventScannerView, type ScannerPhase } from "../../app/src/ui/event-scanner";
import { EventCaptureView, type CaptureStage } from "../../app/src/ui/share-capture";
import type { LinkedEvent } from "../../app/src/ui/share-work";
import { LegalFooter } from "../../app/src/ui/legal";
import { ModerationNavigation } from "../../app/src/ui/moderation";
import { emptyProject, type ProjectFields } from "../../app/src/projects/model";
import { useRecordingPreview } from "./use-recording-preview";
import { useAgentPreview } from "./use-agent-preview";
import { IntegrationsPreview } from "./integrations-preview";

const events: LinkedEvent[] = [
  {
    id: "demo",
    title: "Bratislava Demo Night",
    starts: "9 November",
    from: "9 November",
    to: "10 November",
    timezone: "Europe/Bratislava",
    location: "Campus",
    state: "open",
  },
  {
    id: "builders",
    title: "Prague Builders",
    starts: "9 November",
    from: "9 November",
    to: "10 November",
    timezone: "Europe/Prague",
    location: "Studio",
    state: "open",
  },
];
export function OptionalEventPreview({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<
    "choice" | "scan" | "capture" | "admin" | "integrations" | "moderation"
  >("choice");
  const [count, setCount] = useState(0);
  const [event, setEvent] = useState<LinkedEvent | null>(null);
  const [stage, setStage] = useState<CaptureStage>("choice");
  const [fields, setFields] = useState<ProjectFields>(structuredClone(emptyProject));
  const [retained, setRetained] = useState(false);
  const [agentReview, setAgentReview] = useState(false);
  const [scanner, setScanner] = useState<ScannerPhase>("idle");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const proposal = (fromAgent: boolean) => {
    setAgentReview(fromAgent);
    setFields({
      ...structuredClone(emptyProject),
      title: "Neighbourhood tool library",
      problem: "Neighbours buy tools they rarely use.",
      description: "A shared catalogue helps neighbours borrow tools locally.",
    });
    setStage("proposal");
    setRetained(true);
  };
  const recorder = useRecordingPreview(stage, setStage, screen === "capture", true, () =>
    proposal(false),
  );
  const agent = useAgentPreview(
    screen === "capture" && stage === "agent",
    stage === "proposal",
    true,
    () => proposal(true),
    () => {},
  );
  const begin = (selected: LinkedEvent | null) => {
    setEvent(selected);
    setStage("choice");
    setScreen("capture");
  };
  const reset = () => {
    recorder.reset();
    agent.reset();
    setFields(structuredClone(emptyProject));
    setStage("choice");
    setRetained(false);
    setEvent(null);
    setAgentReview(false);
    setScreen("choice");
    setMessage("");
    setUrl("");
    setScanner("idle");
  };
  const scan = () => {
    setScanner("idle");
    setMessage("");
    setScreen("scan");
  };
  const link = () => {
    setCount(Math.max(1, count));
    begin(events[0]);
  };
  const admin = ["admin", "integrations", "moderation"].includes(screen);
  return (
    <>
      <header className="access-header">
        <BrandLogo />
        <Button variant="quiet" onClick={onExit}>
          Catalogue
        </Button>
      </header>
      <main className="access-main">
        {admin && (
          <>
            <ModerationNavigation
              active={
                screen === "integrations"
                  ? "integrations"
                  : screen === "moderation"
                    ? "moderation"
                    : "events"
              }
              onNavigate={(path) =>
                setScreen(
                  path.endsWith("integrations")
                    ? "integrations"
                    : path.endsWith("moderation")
                      ? "moderation"
                      : "admin",
                )
              }
            />
            {screen === "integrations" ? (
              <IntegrationsPreview />
            ) : (
              <section className="access-card">
                <h1>{screen === "admin" ? "Admin events" : "Moderation"}</h1>
                <p>Use API setup to configure pitch processing.</p>
              </section>
            )}
          </>
        )}
        {screen === "choice" && (
          <EventChoiceView
            events={events.slice(0, count)}
            retained={retained}
            onScan={scan}
            onWithoutEvent={() => begin(null)}
            onSelect={begin}
            onResume={() => setScreen("capture")}
            onDiscard={reset}
          />
        )}
        {screen === "scan" && (
          <>
            <EventScannerView
              phase={scanner}
              message={message}
              value={url}
              onStart={() => {
                setScanner("scanning");
                setMessage("Fictional camera ready. Use Simulate valid event QR below.");
              }}
              onStop={() => setScanner("idle")}
              onChange={setUrl}
              onResolve={() => {
                if (url === "https://luma.com/sample-demo-night") link();
                else {
                  setScanner("error");
                  setMessage("Event not found. Check the link, or continue without an event.");
                }
              }}
              onCancel={() => setScreen("choice")}
              onWithoutEvent={() => begin(null)}
            />
          </>
        )}
        {screen === "capture" && (
          <EventCaptureView
            event={event}
            stage={stage}
            fields={fields}
            recorder={recorder}
            agent={agent.view}
            agentReview={agentReview}
            finishReason="Fictional processing"
            busy={false}
            error=""
            canSave={Boolean(fields.title.trim() && fields.description.trim())}
            onChange={(value) => {
              setFields(value);
              setRetained(true);
            }}
            onMethod={(method) => {
              setStage(method);
              setRetained(true);
            }}
            onStop={() => proposal(false)}
            onSave={() => {
              setStage("saved");
              setRetained(true);
            }}
            onBack={() => setScreen("choice")}
            onAnother={reset}
            onProjects={() => setStage("typed")}
            onRetry={() => proposal(false)}
            onDiscard={reset}
            saved={stage === "saved"}
          />
        )}
        <aside className="access-card" aria-label="Fictional scenario controls">
          <p className="eyebrow">FICTIONAL PREVIEW · SIGNED IN AS ALEX</p>
          <p className="small muted">
            No uploads, camera access or live API calls. Changes last only in this preview.
          </p>
          <label htmlFor="fixture-linked-count">Linked events</label>
          <select
            id="fixture-linked-count"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            <option value={0}>None</option>
            <option value={1}>One</option>
            <option value={2}>Two</option>
          </select>
          <Button variant="quiet" onClick={() => setScreen(admin ? "choice" : "admin")}>
            {admin ? "Author flow" : "Admin workspace"}
          </Button>
          <Button variant="quiet" onClick={reset}>
            Reset preview
          </Button>
          {screen === "scan" && (
            <Button variant="secondary" onClick={link}>
              Simulate valid event QR
            </Button>
          )}
          {stage === "agent" && screen === "capture" && (
            <Button
              variant="secondary"
              disabled={!agent.simulation.canUpload}
              onClick={agent.simulation.onUpload}
            >
              Simulate agent upload
            </Button>
          )}
        </aside>
      </main>
      <LegalFooter privacyHref="#legal/privacy" termsHref="#legal/terms" />
    </>
  );
}
