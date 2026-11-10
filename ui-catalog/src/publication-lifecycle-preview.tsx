"use client";
import { useEffect, useRef, useState } from "react";
import { ProjectDeleteView, type DeletionPhase } from "../../app/src/ui/project-deletion";
import { Button } from "../../app/src/ui/components";
import { ShareMessageView, ShareShell } from "../../app/src/ui/share-work";
import { PublicationOptionsView, type PublicationChoices } from "../../app/src/ui/publication";
import {
  LifecyclePublicView,
  PublicationLifecycleEditor,
  PublicationRevisionReview,
  PublicationWithdrawView,
  type PublicationVisibility,
} from "../../app/src/ui/publication-lifecycle";
import {
  sampleProject,
  previewProjection,
  validContact,
  safePublicLink,
} from "./publication-fixtures";

const startingChoices: PublicationChoices = {
  name: "Alex Builder",
  contactKind: "profile",
  contact: "https://example.com/alex",
  includeProjectLink: true,
  includeRepositoryLink: false,
  includeDetails: false,
};
const owner = { id: "fictional-lifecycle-owner", name: "Alex Builder", email: "alex@example.test" };
type Screen =
  "editor" | "options" | "review" | "withdraw" | "public" | "uncertain" | "conflict" | "delete";
type Action = "publish" | "withdraw" | "delete";
type Outcome = "success" | "failure" | "lost";

export function PublicationLifecyclePreview({ onExit }: { onExit: () => void }) {
  const [fields, setFields] = useState(sampleProject);
  const [saved, setSaved] = useState(sampleProject);
  const [choices, setChoices] = useState(startingChoices);
  const [published, setPublished] = useState(() =>
    previewProjection(sampleProject(), startingChoices),
  );
  const [review, setReview] = useState(published);
  const [visibility, setVisibility] = useState<PublicationVisibility>("published");
  const [version, setVersion] = useState(1);
  const [expected, setExpected] = useState(1);
  const [screen, setScreen] = useState<Screen>("editor");
  const [returnScreen, setReturnScreen] = useState<Screen>("editor");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deletePhase, setDeletePhase] = useState<DeletionPhase>("confirm");
  const [session, setSession] = useState(true);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("success");
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    mainRef.current?.focus();
  }, [screen, session, denied, loading]);
  const unsaved = JSON.stringify(fields) !== JSON.stringify(saved);

  function reset() {
    generation.current += 1;
    setBusy(false);
    setDeleted(false);
    setDeletePhase("confirm");
    setFields(sampleProject());
    setSaved(sampleProject());
    setChoices(startingChoices);
    const initial = previewProjection(sampleProject(), startingChoices);
    setPublished(initial);
    setReview(initial);
    setVisibility("published");
    setVersion(1);
    setExpected(1);
    setScreen("editor");
    setReturnScreen("editor");
    setReviewed(false);
    setSession(true);
    setDenied(false);
    setLoading(false);
    setClosed(false);
    setRestricted(false);
    setOutcome("success");
    setPending(null);
    setError("");
    setNotice("");
  }
  function changeScreen(next: Screen) {
    setError("");
    setReviewed(false);
    setScreen(next);
  }
  function prepareOptions() {
    if (![fields.title, fields.problem, fields.description].every((value) => value.trim())) {
      setError("Add a project name, problem and description before continuing.");
      return;
    }
    setSaved(structuredClone(fields));
    setNotice("Private changes saved. Your public page is unchanged.");
    changeScreen("options");
  }
  function prepareReview() {
    if (
      !validContact(choices) ||
      (choices.includeProjectLink && !safePublicLink(fields.project_url)) ||
      (choices.includeRepositoryLink && !safePublicLink(fields.repository_url))
    ) {
      setError(
        "Choose a public name, valid contact and safe HTTPS links, or leave optional links out.",
      );
      return;
    }
    setReview(previewProjection(fields, choices));
    setExpected(version);
    changeScreen("review");
  }
  function finish(action: Action) {
    if (action === "delete") {
      setDeleted(true);
      setPending(null);
      setReviewed(false);
      setScreen("editor");
      return;
    }
    setNotice(
      action === "withdraw"
        ? "Project withdrawn. Your private content is kept."
        : "Publication confirmed. Your public page is up to date.",
    );
    setPending(null);
    setReviewed(false);
    setScreen("editor");
  }
  async function mutate(action: Action) {
    if (busy || !session || denied || deleted || pending || (action === "publish" && !reviewed))
      return;
    setError("");
    if (expected !== version) {
      if (action === "delete") {
        setDeletePhase("conflict");
        return;
      }
      setReturnScreen(action === "publish" ? "options" : "editor");
      setScreen("conflict");
      setReviewed(false);
      return;
    }
    if (action === "publish" && restricted) {
      setError(
        "Publishing is unavailable while the event or project is restricted. Your private changes are kept.",
      );
      return;
    }
    const requestGeneration = generation.current;
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (!mounted.current || requestGeneration !== generation.current) return;
    setBusy(false);
    setOutcome("success");
    if (outcome === "failure") {
      setError("The request failed before saving. Your content is kept. Try again.");
      return;
    }
    if (action === "withdraw") setVisibility("withdrawn");
    else if (action === "publish") {
      setPublished(review);
      setVisibility("published");
    }
    setVersion((value) => value + 1);
    if (outcome === "lost") {
      setPending(action);
      if (action === "delete") setDeletePhase("uncertain");
      else setScreen("uncertain");
      return;
    }
    finish(action);
  }
  function otherAccount() {
    reset();
    setFields({
      ...sampleProject(),
      title: "",
      problem: "",
      description: "",
      project_url: "",
      repository_url: "",
    });
    setDenied(true);
  }

  return (
    <>
      <aside className="access-fixtures" aria-label="Publication lifecycle simulation">
        <p className="eyebrow">PUBLICATION LIFECYCLE · FICTIONAL CATALOGUE</p>
        <p>No real project is changed. Reset or reload clears this preview.</p>
        <fieldset disabled={busy}>
          <label htmlFor="lifecycle-outcome">Next request outcome</label>
          <select
            id="lifecycle-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as Outcome)}
          >
            <option value="success">Success</option>
            <option value="failure">Definite failure</option>
            <option value="lost">Saved, response lost</option>
          </select>
          <label>
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />{" "}
            Event closed (fixture)
          </label>
          <label>
            <input
              type="checkbox"
              checked={restricted}
              onChange={(e) => setRestricted(e.target.checked)}
            />{" "}
            Publishing restricted (fixture)
          </label>
          <label>
            <input
              type="checkbox"
              checked={loading}
              onChange={(e) => setLoading(e.target.checked)}
            />{" "}
            Loading (fixture)
          </label>
          <div className="access-fixture-actions">
            <Button variant="secondary" onClick={() => setVersion((value) => value + 1)}>
              Concurrent change (fixture)
            </Button>
            <Button variant="secondary" onClick={() => setSession(false)}>
              Expire session (fixture)
            </Button>
            <Button variant="secondary" onClick={otherAccount}>
              Different account (fixture)
            </Button>
            <Button variant="secondary" onClick={reset}>
              Reset preview
            </Button>
            <Button variant="quiet" onClick={onExit}>
              Back to catalogue
            </Button>
          </div>
        </fieldset>
      </aside>
      <ShareShell
        user={session && !denied ? owner : null}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={() => {
          if (!busy && !pending && !deleted && screen !== "conflict" && deletePhase !== "conflict")
            changeScreen("editor");
        }}
        onSignIn={() => setSession(true)}
        onSignOut={otherAccount}
      >
        {!session ? (
          <ShareMessageView
            title="Sign in to continue."
            message="Your private work is hidden. Sign in with the same account to resume."
            action="Resume same account (fixture)"
            onAction={() => setSession(true)}
            onHome={onExit}
          />
        ) : denied ? (
          <ShareMessageView
            title="Project unavailable."
            message="This account cannot access the project. No private edits were carried into this account."
            onHome={onExit}
          />
        ) : deleted ? (
          <ShareMessageView
            title="Project deleted."
            message="This project is no longer in My projects or the gallery. It cannot be republished."
            onHome={onExit}
          />
        ) : loading ? (
          <ShareMessageView
            title="Loading project…"
            message="Checking your access and current project state."
            onHome={onExit}
          />
        ) : screen === "uncertain" ? (
          <ShareMessageView
            title="Checking the result."
            message="The connection was interrupted. Check the original request before making another change."
            action="Check result"
            onAction={() => {
              if (pending) finish(pending);
            }}
            onHome={onExit}
          />
        ) : screen === "conflict" ? (
          <ShareMessageView
            title="The project changed elsewhere."
            message="Your edits are kept. Review the latest state before confirming a new action."
            action="Review latest state"
            onAction={() => {
              setExpected(version);
              changeScreen(returnScreen);
            }}
            onHome={onExit}
          />
        ) : screen === "delete" ? (
          <ProjectDeleteView
            title={saved.title}
            event={published.event ?? "No event linked"}
            published={visibility === "published"}
            unsaved={unsaved}
            phase={busy ? "deleting" : deletePhase}
            error={error}
            onKeep={() => changeScreen("editor")}
            onConfirm={() => void mutate("delete")}
            onCheck={() => {
              if (pending === "delete") finish("delete");
            }}
            onRefresh={() => {
              setDeletePhase("confirm");
              setExpected(version);
              changeScreen("editor");
            }}
          />
        ) : screen === "editor" ? (
          <PublicationLifecycleEditor
            fields={fields}
            event="Bratislava Demo Night"
            visibility={restricted && visibility === "published" ? "hidden" : visibility}
            version={version}
            notice={
              notice ||
              (closed
                ? "Submissions are closed. You can still update or withdraw this existing project."
                : "")
            }
            error={error}
            busy={busy}
            onChange={(value) => {
              setFields(value);
              setReviewed(false);
              setNotice("");
            }}
            onDelete={() => {
              setExpected(version);
              setDeletePhase("confirm");
              changeScreen("delete");
            }}
            onContinue={prepareOptions}
            onPublic={() => changeScreen("public")}
            onWithdraw={() => {
              setExpected(version);
              changeScreen("withdraw");
            }}
          />
        ) : screen === "options" ? (
          <PublicationOptionsView
            title={fields.title}
            event="Bratislava Demo Night"
            choices={choices}
            projectUrl={fields.project_url}
            repositoryUrl={fields.repository_url}
            error={error}
            onChange={(value) => {
              setChoices(value);
              setReviewed(false);
            }}
            onContinue={prepareReview}
            onBack={() => changeScreen("editor")}
          />
        ) : screen === "review" ? (
          <PublicationRevisionReview
            previous={published}
            next={review}
            version={expected}
            visibility={visibility}
            reviewed={reviewed}
            busy={busy}
            error={error}
            onReviewed={setReviewed}
            onEdit={() => changeScreen("options")}
            onPublish={() => void mutate("publish")}
          />
        ) : screen === "withdraw" ? (
          <PublicationWithdrawView
            title={published.title}
            event={published.event ?? "No event linked"}
            unsaved={unsaved}
            busy={busy}
            error={error}
            onCancel={() => changeScreen("editor")}
            onConfirm={() => void mutate("withdraw")}
          />
        ) : visibility === "withdrawn" ? (
          <ShareMessageView
            title="Project unavailable."
            message="Visitors and agents cannot read this project while it is withdrawn."
            action="Back to private editor"
            onAction={() => changeScreen("editor")}
            onHome={onExit}
          />
        ) : (
          <LifecyclePublicView content={published} onBack={() => changeScreen("editor")} />
        )}
      </ShareShell>
    </>
  );
}
