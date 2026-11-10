"use client";
import { useEffect, useRef, useState } from "react";
import type { ProjectFields } from "../../app/src/projects/model";
import { Button } from "../../app/src/ui/components";
import {
  PublicationEditorView,
  PublicationOptionsView,
  PublicationReviewView,
  PublicationSuccessView,
  PublicProjectContentView,
  PublicEventProjectsView,
  type PublicationChoices,
  type PublicProjectContent,
} from "../../app/src/ui/publication";
import { OwnProjectsView, ShareMessageView, ShareShell } from "../../app/src/ui/share-work";
import { eventViews, fixtureTime, identities } from "./sharing-fixtures";

import {
  sampleProject,
  previewProjection,
  validContact,
  safePublicLink,
} from "./publication-fixtures";

type Screen = "start" | "projects" | "options" | "review" | "success" | "public" | "event";
const initialChoices: PublicationChoices = {
  name: "",
  contactKind: "profile",
  contact: "",
  includeProjectLink: false,
  includeRepositoryLink: false,
  includeDetails: false,
};

export function PublicationPreview({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>("start");
  const [fields, setFields] = useState(sampleProject);
  const [choices, setChoices] = useState(initialChoices);
  const [review, setReview] = useState<PublicProjectContent | null>(null);
  const [published, setPublished] = useState<PublicProjectContent | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [uncertainPreview, setUncertainPreview] = useState(false);
  const [failure, setFailure] = useState(false);
  const [stale, setStale] = useState(false);
  const [closed, setClosed] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [filter, setFilter] = useState<"all" | "saved" | "unfinished">("all");
  const generation = useRef(0);
  const mainRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLDetailsElement>(null);
  const event = eventViews(
    fixtureTime,
    closed ? ["demo-night"] : [],
    suspended ? ["demo-night"] : [],
  )[0];
  const go = (value: Screen) => {
    setError("");
    setRecovery("");
    setUncertainPreview(false);
    setScreen(value);
  };
  useEffect(() => {
    mainRef.current?.focus();
  }, [screen, signedOut]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const reset = () => {
    generation.current++;
    setFields(sampleProject());
    setChoices(initialChoices);
    setReview(null);
    setPublished(null);
    setReviewed(false);
    setBusy(false);
    setFailure(false);
    setStale(false);
    setClosed(false);
    setSuspended(false);
    setSignedOut(false);
    setFilter("all");
    go("start");
  };
  const publish = async () => {
    if (!reviewed || !review || busy) return;
    if (suspended) {
      setError(
        "This event is suspended. Your project is still private; try again when access is restored.",
      );
      return;
    }
    if (stale) {
      setError(
        "The project changed since this preview. Edit public details and review the current version before publishing.",
      );
      setReviewed(false);
      return;
    }
    setBusy(true);
    setError("");
    const current = generation.current;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (current !== generation.current) return;
    setBusy(false);
    if (failure) {
      setFailure(false);
      setError("Publication failed. Your project and choices are kept. Try Publish project again.");
      return;
    }
    setPublished(structuredClone(review));
    go("success");
  };
  const expireSession = () => {
    generation.current++;
    setBusy(false);
    setSignedOut(true);
    setReviewed(false);
  };
  const publicScreen = screen === "public" || screen === "event";
  return (
    <>
      <aside className="access-fixtures" aria-label="Publication catalogue controls">
        <strong>PUBLICATION · PHASE 0 PREVIEW</strong>
        <p>
          Fictional saved project and identity. No requests, public writes or messages. Changes stay
          in this tab and reset on reload.
        </p>
        <details>
          <summary>Publication scenarios</summary>
          <fieldset disabled={busy} className="share-methods">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={closed}
                onChange={(e) => setClosed(e.target.checked)}
              />{" "}
              Event closed after submission
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={suspended}
                onChange={(e) => setSuspended(e.target.checked)}
              />{" "}
              Event suspended
            </label>
            <Button
              variant="quiet"
              onClick={() =>
                setRecovery("This review expired. Edit public details to prepare a fresh preview.")
              }
            >
              Expired review
            </Button>
            <Button variant="quiet" onClick={() => setUncertainPreview(true)}>
              Uncertain publication
            </Button>
            <Button
              variant="quiet"
              onClick={() =>
                setRecovery(
                  "This historical project has no verified admission. It remains private and editable; publication needs a live submission window.",
                )
              }
            >
              Unverified admission
            </Button>
            <Button variant="quiet" onClick={() => setFailure(true)}>
              Fail next publish (fixture)
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setStale(true);
                setFields((value) => ({ ...value, title: "Offline notes — newer saved version" }));
              }}
            >
              Invalidate review (fixture)
            </Button>
            <Button variant="quiet" onClick={expireSession}>
              Expire session (fixture)
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setSignedOut(false);
                setReviewed(false);
              }}
            >
              Restore same identity (fixture)
            </Button>
            <Button variant="quiet" onClick={() => go("event")}>
              View event (fixture)
            </Button>
            <Button variant="quiet" onClick={reset}>
              Reset publication preview
            </Button>
            <Button variant="quiet" onClick={onExit}>
              Back to catalogue
            </Button>
          </fieldset>
        </details>
      </aside>
      <ShareShell
        user={signedOut || publicScreen ? null : identities[0]}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={() => go("projects")}
        onSignIn={() => {
          setSignedOut(true);
          go("start");
        }}
        onSignOut={expireSession}
      >
        {signedOut && !publicScreen ? (
          <ShareMessageView
            title="Sign in to continue."
            message="Your project and publication choices are retained in this tab. Sign in with the same account to continue reviewing."
            onHome={() => go("event")}
          />
        ) : uncertainPreview ? (
          <ShareMessageView
            title="Publication not yet confirmed."
            message="Check the original receipt before continuing. Retrying uses the same reviewed project and request."
            action="Check publication"
            onAction={() => {
              setUncertainPreview(false);
              setError("No publication was confirmed. Review your preview before trying again.");
            }}
            onHome={() => go("projects")}
          />
        ) : (
          <>
            {screen === "start" && (
              <PublicationEditorView
                fields={fields}
                event={event.title}
                error={recovery || error}
                onChange={(value) => {
                  setFields(value);
                  setReviewed(false);
                }}
                onBack={() => go("projects")}
                onContinue={() => {
                  if (
                    ![fields.title, fields.problem, fields.description].every((value) =>
                      value.trim(),
                    )
                  ) {
                    setError(
                      "Add a project name, the problem it solves and what you built before publication.",
                    );
                    return;
                  }
                  go("options");
                }}
              />
            )}
            {screen === "projects" && (
              <OwnProjectsView
                projects={[
                  {
                    id: "sample",
                    eventId: event.id,
                    title: fields.title,
                    updated: "just now",
                    saved: true,
                    published: !!published,
                    unfinished: false,
                    status: "Confirmed",
                    method: "Agent",
                  },
                ]}
                events={[event]}
                filter={filter}
                onFilter={setFilter}
                onOpen={() => go("start")}
                onHome={onExit}
                onShare={() => go("start")}
              />
            )}
            {screen === "options" && (
              <PublicationOptionsView
                title={fields.title}
                event={event.title}
                choices={choices}
                projectUrl={fields.project_url}
                repositoryUrl={fields.repository_url}
                error={recovery || error}
                onChange={(value) => {
                  setChoices(value);
                  setReviewed(false);
                }}
                onBack={() => go("start")}
                onContinue={() => {
                  if (!validContact(choices)) {
                    setError(
                      "Enter a public name and a valid email or HTTPS profile link without credentials.",
                    );
                    return;
                  }
                  if (
                    (choices.includeProjectLink && !safePublicLink(fields.project_url)) ||
                    (choices.includeRepositoryLink && !safePublicLink(fields.repository_url))
                  ) {
                    setError(
                      "Selected links must be HTTPS addresses without credentials. Edit the project link or leave it private.",
                    );
                    return;
                  }
                  setReview(previewProjection(fields, choices));
                  setReviewed(false);
                  setStale(false);
                  go("review");
                }}
              />
            )}
            {screen === "review" && review && (
              <PublicationReviewView
                content={review}
                reviewed={reviewed}
                busy={busy}
                error={recovery || error}
                notice={
                  closed
                    ? "Submissions have closed. Your project was received during the live window, so you can still publish it."
                    : ""
                }
                onReviewed={setReviewed}
                onEdit={() => {
                  setReviewed(false);
                  go("options");
                }}
                onRefresh={
                  stale
                    ? () => {
                        setStale(false);
                        setReviewed(false);
                        go("start");
                      }
                    : undefined
                }
                onPublish={() => void publish()}
              />
            )}
            {screen === "success" && published && (
              <PublicationSuccessView
                title={published.title}
                onProject={() => go("public")}
                onEvent={() => go("event")}
              />
            )}
            {screen === "public" && published && (
              <section className="access-card publish-flow">
                <Button variant="quiet" onClick={() => go("event")}>
                  View event projects
                </Button>
                <PublicProjectContentView content={published} />
              </section>
            )}
            {screen === "event" && (
              <PublicEventProjectsView
                event={event.title}
                projects={published ? [published] : []}
                onOpen={() => go("public")}
              />
            )}
          </>
        )}
      </ShareShell>
    </>
  );
}
