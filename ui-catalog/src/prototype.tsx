"use client";

import { OptionalEventPreview } from "./optional-event-preview";
import { OptionalEventPreviewLink } from "../../app/src/ui/event-choice";
import { LegalPreview } from "./legal-preview";
import { MobilePreview } from "./mobile-preview";
import { MobilePreviewLink } from "../../app/src/ui/mobile-support";
import { ModerationPreview } from "./moderation-preview";
import { ModerationPreviewLink } from "../../app/src/ui/moderation";
import { BrandLogo } from "../../app/src/ui/brand";
import { useEffect, useRef, useState } from "react";
import {
  AuthorCard,
  Avatar,
  Button,
  EmptyState,
  Field,
  Icon,
  ProjectCard,
  ProjectStory,
  Stepper,
  Tag,
  TextInput,
} from "../../app/src/ui/components";
import { publicProjectExport, type Project } from "../../app/src/ui/model";
import { componentRegistry } from "../../app/src/ui/registry";
import { AccessPreview } from "./access-preview";
import { PublicationLifecyclePreview } from "./publication-lifecycle-preview";
import { PublicationLifecyclePreviewLink } from "../../app/src/ui/publication-lifecycle";
import { GalleryPreview } from "./gallery-preview";
import { GalleryPreviewLink } from "../../app/src/ui/gallery";
import { DeletionPreview } from "./deletion-preview";
import { ProjectDeletionPreviewLink } from "../../app/src/ui/project-deletion";
import { DraftAgentPreview } from "./draft-agent-preview";
import { DraftAgentPreviewLink } from "../../app/src/ui/draft-agent";
import { PitchRecoveryPreview } from "./pitch-recovery-preview";
import { PitchRecoveryPreviewLink } from "../../app/src/ui/pitch-recovery";
import { SharingPreview } from "./sharing-preview";
import { PublicationPreview } from "./publication-preview";
import { PublicationPreviewLink } from "../../app/src/ui/publication";
import { SharePreviewLink } from "../../app/src/ui/share-work";
import {
  emptyDraft,
  projects as seedProjects,
  publishPreview,
  repositorySuggestion,
  type Draft,
} from "./fixtures";

type Filter = "all" | "tool" | "pattern" | "feedback";
type RepoState = "choose" | "working" | "ready" | "error";

export function Prototype() {
  const [view, setView] = useState("");
  const [projects, setProjects] = useState(seedProjects);
  const [saved, setSaved] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"event" | "all">("event");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });
  const [step, setStep] = useState(0);
  const [repoState, setRepoState] = useState<RepoState>("choose");
  const [repoAllowed, setRepoAllowed] = useState(false);
  const [suggestionAccepted, setSuggestionAccepted] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [toast, setToast] = useState("");
  const [wasPublished, setWasPublished] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const resetRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const change = () => {
      setView(window.location.hash.slice(1));
      window.scrollTo({ top: 0 });
    };
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    setShowJson(false);
  }, [view]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (repoState !== "working") return;
    const timer = window.setTimeout(() => setRepoState("ready"), 1300);
    return () => window.clearTimeout(timer);
  }, [repoState]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName) &&
        searchRef.current
      ) {
        event.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const go = (destination: string) => {
    // Keep the rendered route in the same update as session changes. Waiting for
    // hashchange lets the old protected screen redirect during explicit sign-out.
    setView(destination);
    window.location.hash = destination;
  };
  const update = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setReviewed(false);
    if (field === "recoveryEmail") {
      setVerified(false);
      setVerificationSent(false);
    }
  };
  const save = (project: Project) => {
    setSaved((current) =>
      current.includes(project.id)
        ? current.filter((id) => id !== project.id)
        : [...current, project.id],
    );
  };
  const selected = projects.find((project) => `project/${project.id}` === view);
  const preview = publishPreview(draft);
  const isCollection = view === "saved";
  const filtered = projects.filter(
    (project) =>
      (isCollection
        ? saved.includes(project.id)
        : scope === "all" || project.event === "bratislava") &&
      (filter === "all" ||
        (filter === "feedback" && project.feedback) ||
        filter === project.intent) &&
      query
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .every((term) =>
          [
            project.title,
            project.problem,
            project.description,
            project.takeaway,
            project.limitation,
            ...project.tags,
            project.author.name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(term),
        ),
  );
  const allCount = projects.filter(
    (project) => scope === "all" || project.event === "bratislava",
  ).length;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied to clipboard.");
    } catch {
      setToast("Copy is unavailable in this browser. You can select the displayed text.");
    }
  };
  const reset = () => {
    setProjects(seedProjects);
    setSaved([]);
    setDraft({ ...emptyDraft });
    setStep(0);
    setRepoState("choose");
    setRepoAllowed(false);
    setSuggestionAccepted(false);
    setVerified(false);
    setVerificationSent(false);
    setReviewed(false);
    setWasPublished(false);
    setQuery("");
    setFilter("all");
    setScope("event");
    resetRef.current?.close();
    go("");
    setToast("Preview reset. All sample projects are back.");
  };
  const publish = () => {
    if (!verified || !reviewed) return;
    setProjects((current) => [preview, ...current.filter((project) => project.id !== preview.id)]);
    setWasPublished(true);
    setStep(0);
    go("project/your-project");
    setToast("Added to this preview. Nothing was published online.");
  };
  const start = () => {
    if (wasPublished) setStep(0);
    go("submit");
  };

  if (view === "optional-event") return <OptionalEventPreview onExit={() => go("catalogue")} />;
  if (view.startsWith("legal/")) return <LegalPreview terms={view === "legal/terms"} />;
  if (view === "mobile") return <MobilePreview onExit={() => go("catalogue")} />;
  if (view === "moderation") return <ModerationPreview onExit={() => go("catalogue")} />;
  if (view === "publication-lifecycle")
    return <PublicationLifecyclePreview onExit={() => go("catalogue")} />;
  if (view === "gallery") return <GalleryPreview onExit={() => go("catalogue")} />;
  if (view === "delete-project") return <DeletionPreview onExit={() => go("catalogue")} />;
  if (view === "refine") return <DraftAgentPreview onExit={() => go("catalogue")} />;
  if (view === "recovery") return <PitchRecoveryPreview onExit={() => go("catalogue")} />;

  if (view === "publish" || view.startsWith("publish/")) {
    return <PublicationPreview onExit={() => go("catalogue")} />;
  }

  if (view === "share" || view.startsWith("share/")) {
    return (
      <SharingPreview route={view.slice(6) || "home"} navigate={(route) => go(`share/${route}`)} />
    );
  }

  if (view === "access" || view.startsWith("access/")) {
    return (
      <AccessPreview route={view.slice(7) || "home"} navigate={(route) => go(`access/${route}`)} />
    );
  }

  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="preview-strip">
        <div>
          <span className="preview-dot" /> INTERACTIVE PREVIEW{" "}
          <span className="preview-explanation">
            Fictional projects. No emails or repository access.
          </span>
        </div>
        <button onClick={() => resetRef.current?.showModal()}>
          Reset demo <Icon name="loop" size={12} />
        </button>
      </div>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#" aria-label="brag.codes home">
            <BrandLogo />
          </a>
          <nav className="desktop-nav" aria-label="Main">
            <a className={!view || view.startsWith("project/") ? "active" : ""} href="#">
              Discover
            </a>
            <a className={isCollection ? "active" : ""} href="#saved">
              My collection{saved.length > 0 && <span className="nav-count">{saved.length}</span>}
            </a>
            <a className={view === "agents" ? "active" : ""} href="#agents">
              For agents <Icon name="code" size={15} />
            </a>
          </nav>
          <Button onClick={start}>
            <Icon name="plus" size={17} />
            <span>Share a project</span>
          </Button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className={!view ? "active" : ""} href="#">
          Discover
        </a>
        <a className={isCollection ? "active" : ""} href="#saved">
          Collection {saved.length > 0 && `(${saved.length})`}
        </a>
        <a className={view === "agents" ? "active" : ""} href="#agents">
          For agents
        </a>
      </nav>
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {(!view || isCollection) && (
          <div className="page-shell">
            <div className="hero-grid">
              <div className="hero">
                <p className="eyebrow">
                  <span className="small-cross">✳</span> BUILT WITH CURIOSITY. SHARED WITH EVERYONE.
                </p>
                <h1>
                  {isCollection ? (
                    <>
                      Good finds.
                      <br />
                      <span>Kept close.</span>
                    </>
                  ) : (
                    <>
                      Small projects.
                      <br />
                      <span>Unexpected possibilities.</span>
                    </>
                  )}
                </h1>
                <p className="hero-copy">
                  {isCollection
                    ? "A little collection of work worth coming back to. Saved for this preview session."
                    : "Discover what people are making, the problems they’re solving, and the clever bits worth borrowing."}
                </p>
              </div>
              <EventCard
                onBrowse={() => {
                  setScope("event");
                  setFilter("all");
                  setQuery("");
                  go("");
                  document.getElementById("discovery")?.scrollIntoView({ behavior: "smooth" });
                }}
              />
            </div>
            <div className="discovery-layout" id="discovery">
              <section className="feed" aria-label="Project discovery">
                <div className="feed-heading">
                  <div className="scope-tabs" aria-label="Search scope">
                    {isCollection ? (
                      <h2>
                        Your collection <span>{saved.length}</span>
                      </h2>
                    ) : (
                      <>
                        <button
                          className={scope === "event" ? "selected" : ""}
                          onClick={() => setScope("event")}
                          aria-pressed={scope === "event"}
                        >
                          This event{" "}
                          <span>{projects.filter((p) => p.event === "bratislava").length}</span>
                        </button>
                        <button
                          className={scope === "all" ? "selected" : ""}
                          onClick={() => setScope("all")}
                          aria-pressed={scope === "all"}
                        >
                          All projects <span>{projects.length}</span>
                        </button>
                      </>
                    )}
                  </div>
                  <span className="feed-sort">
                    {isCollection ? "Your picks" : "Fresh from the builders"}
                    <Icon name="spark" size={14} />
                  </span>
                </div>
                <div className="search-field">
                  <Icon name="search" size={21} />
                  <input
                    ref={searchRef}
                    aria-label="Search projects"
                    placeholder="A problem, a pattern, a spark of an idea…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <Icon name="close" size={17} />
                    </button>
                  ) : (
                    <kbd>/</kbd>
                  )}
                </div>
                <div className="filters" aria-label="Project filters">
                  {(
                    [
                      ["all", "All ideas"],
                      ["tool", "Tools to use"],
                      ["pattern", "Patterns to learn"],
                      ["feedback", "Looking for feedback"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "chosen" : ""}
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="result-count" role="status">
                  {filtered.length} {filtered.length === 1 ? "project" : "projects"}
                  {query && (
                    <>
                      {" "}
                      matching <strong>“{query}”</strong>
                    </>
                  )}
                  {!query && !isCollection && (
                    <span>
                      {" "}
                      / {scope === "event" ? "AI Builders Bratislava" : "Across the community"}
                    </span>
                  )}
                </p>
                {filtered.length ? (
                  <div className="project-grid">
                    {filtered.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        saved={saved.includes(project.id)}
                        onSave={() => save(project)}
                        onOpen={() => go(`project/${project.id}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={
                      isCollection && !saved.length
                        ? "Your next good find is out there."
                        : "No projects found. Yet."
                    }
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                          if (isCollection && !saved.length) go("");
                        }}
                      >
                        {" "}
                        {isCollection && !saved.length ? "Explore projects" : "Clear filters"}{" "}
                        <Icon name="arrow" size={16} />
                      </Button>
                    }
                  >
                    {isCollection && !saved.length
                      ? "Use the bookmark on a project to keep it here."
                      : "Try a broader term like offline, search or workflow. A great match might describe the problem differently."}
                  </EmptyState>
                )}
                {!!filtered.length && (
                  <div className="feed-end">
                    <span />
                    {query || filter !== "all"
                      ? "A smaller list. A better starting point."
                      : `That’s all ${isCollection ? "your finds" : allCount + " projects"} for now.`}
                    <span />
                  </div>
                )}
              </section>
              <aside className="discovery-sidebar">
                <div className="share-note">
                  <span className="note-symbol">
                    <Icon name="spark" size={27} />
                  </span>
                  <p className="eyebrow">YOUR SIDE PROJECT BELONGS HERE</p>
                  <h2>
                    It doesn’t have
                    <br />
                    to be finished.
                    <br />
                    <em>Just interesting.</em>
                  </h2>
                  <p>
                    A tiny tool. A useful experiment. Something that made your own day a little
                    easier.
                  </p>
                  <Button variant="secondary" onClick={start}>
                    Share what you built <Icon name="arrow" size={16} />
                  </Button>
                  <span className="small muted">A description is enough. A repo is optional.</span>
                </div>
                <div className="agent-note">
                  <Icon name="terminal" size={23} />
                  <h3>Let your agent find the needle.</h3>
                  <p>Give it a problem. Discover projects and patterns that could help.</p>
                  <a href="#agents">
                    Explore agent discovery <Icon name="arrow" size={15} />
                  </a>
                </div>
                <div className="community-note">
                  <div className="avatar-stack">
                    {seedProjects.slice(0, 4).map((p) => (
                      <Avatar author={p.author} key={p.id} />
                    ))}
                  </div>
                  <p>
                    Small things, made by real people.
                    <br />
                    <span className="muted">This preview uses fictional builders.</span>
                  </p>
                </div>
              </aside>
            </div>
          </div>
        )}

        {view.startsWith("project/") && (
          <div className="page-shell detail-page">
            <div className="detail-toolbar">
              <button className="text-back" onClick={() => go("")}>
                <Icon name="back" size={16} />
                Back to projects
              </button>
              {selected && (
                <Button variant="secondary" onClick={() => save(selected)}>
                  <Icon name="bookmark" size={17} />
                  {saved.includes(selected.id) ? "Saved to collection" : "Save project"}
                </Button>
              )}
            </div>
            {selected ? (
              <>
                {selected.id === "your-project" && (
                  <div className="success-banner">
                    <Icon name="check" />
                    <span>
                      Your project is in the preview feed.{" "}
                      <strong>Nothing has been published online.</strong>
                    </span>
                    <button
                      onClick={() => {
                        setStep(0);
                        go("submit");
                      }}
                    >
                      Edit draft
                    </button>
                  </div>
                )}
                <div className="detail-grid">
                  <div>
                    <ProjectStory project={selected} />
                    <div className="provenance-note">
                      <Icon name={selected.source === "private" ? "lock" : "paper"} size={19} />
                      <div>
                        <strong>
                          {selected.source === "description"
                            ? "Described by the author"
                            : selected.source === "private"
                              ? "Private source. Public description."
                              : "Repository-assisted description"}
                        </strong>
                        <p>
                          {selected.source === "private"
                            ? "Only the author-approved description is shared. Contact the author to discuss the work; repository access is separate."
                            : "This is a fictional example. Treat the described capabilities as author statements, not independently verified claims."}
                        </p>
                      </div>
                    </div>
                    <button className="text-action" onClick={() => setShowJson(!showJson)}>
                      <Icon name="code" size={17} />
                      {showJson ? "Hide agent-readable record" : "View agent-readable record"}
                    </button>
                    {showJson && (
                      <div className="code-panel">
                        <div>
                          <span>PUBLIC PROJECT · JSON</span>
                          <Button
                            variant="quiet"
                            onClick={() =>
                              copy(JSON.stringify(publicProjectExport(selected), null, 2))
                            }
                          >
                            <Icon name="copy" size={15} />
                            Copy
                          </Button>
                        </div>
                        <pre data-testid="public-json">
                          {JSON.stringify(publicProjectExport(selected), null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                  <div>
                    <AuthorCard author={selected.author} />
                    <div className="detail-event">
                      <Icon name="pin" size={18} />
                      <div>
                        Shared at{" "}
                        <strong>
                          {selected.event === "bratislava"
                            ? "AI Builders Bratislava"
                            : "Vienna Build Club"}
                        </strong>
                        <span>Fictional event · November 2026</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="This project isn’t available."
                action={<Button onClick={() => go("")}>Back to discovery</Button>}
              >
                It may have been removed, or the preview may have been reset.
              </EmptyState>
            )}
          </div>
        )}

        {view === "submit" && (
          <div className="page-shell submission-page">
            <button className="text-back" onClick={() => go("")}>
              <Icon name="back" size={16} />
              Back to discovery
            </button>
            <div className="submission-heading">
              <p className="eyebrow">A SMALL BRAG GOES A LONG WAY</p>
              <h1>Share what you built.</h1>
              <p>There’s someone here who could use your idea.</p>
            </div>
            <Stepper step={step} />
            {step < 2 ? (
              <div className="editor-grid">
                <div className="editor-panel">
                  {step === 0 && (
                    <>
                      <div className="section-title">
                        <span>01</span>
                        <h2>Start with your project</h2>
                      </div>
                      <div className="path-options" aria-label="Submission method">
                        <button
                          className={draft.source === "description" ? "selected" : ""}
                          aria-pressed={draft.source === "description"}
                          onClick={() => {
                            update("source", "description");
                            setRepoState("choose");
                          }}
                        >
                          <Icon name="paper" />
                          <strong>Describe it myself</strong>
                          <span>No repository needed</span>
                        </button>
                        <button
                          className={draft.source === "private" ? "selected" : ""}
                          aria-pressed={draft.source === "private"}
                          onClick={() => update("source", "private")}
                        >
                          <Icon name="code" />
                          <strong>Start from a repository</strong>
                          <span>Get a draft to review</span>
                        </button>
                      </div>
                      {draft.source === "private" && (
                        <div className="repository-panel">
                          <div className="repo-heading">
                            <Icon name="lock" />
                            <div>
                              <strong>A private repo stays private.</strong>
                              <p>Review the description before anything is shared.</p>
                            </div>
                          </div>
                          <span className="simulation-label">
                            SIMULATED CONNECTION · NO GITHUB ACCESS
                          </span>
                          <Field label="Example repository" htmlFor="repository">
                            <select
                              id="repository"
                              className="text-input"
                              disabled={repoState === "working"}
                            >
                              <option>demo-builder/pocket-queue (private)</option>
                            </select>
                          </Field>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={repoAllowed}
                              disabled={repoState === "working"}
                              onChange={(e) => setRepoAllowed(e.target.checked)}
                            />
                            <span>
                              Allow read-only inspection of this sample repository. In the live
                              product, the analysis provider and processing terms will be shown
                              here.
                            </span>
                          </label>
                          {repoState === "working" ? (
                            <div className="analysis-progress" role="status">
                              <span className="spinner" />
                              <div>
                                <strong>Preparing a sample description…</strong>
                                <p>Simulating a read-only inspection.</p>
                              </div>
                              <button onClick={() => setRepoState("choose")}>Cancel</button>
                            </div>
                          ) : repoState === "ready" ? (
                            <div className="suggestion">
                              <p className="eyebrow">
                                <Icon name="spark" size={14} /> DRAFT SUGGESTION
                              </p>
                              <h3>Pocket queue</h3>
                              <p>{repositorySuggestion.description}</p>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setDraft((current) => ({ ...current, ...repositorySuggestion }));
                                  setSuggestionAccepted(true);
                                  setReviewed(false);
                                  setToast("Suggestion added. You can edit every field below.");
                                }}
                              >
                                {suggestionAccepted
                                  ? "Use suggestion again"
                                  : "Use this suggestion"}
                                <Icon name="arrow" size={15} />
                              </Button>
                            </div>
                          ) : repoState === "error" ? (
                            <div className="inline-error" role="alert">
                              <strong>Repository access is unavailable.</strong>
                              <p>
                                Your description is still here. Retry the sample or continue by
                                describing the project yourself.
                              </p>
                              <Button
                                variant="secondary"
                                disabled={!repoAllowed}
                                onClick={() => setRepoState("working")}
                              >
                                Retry sample inspection
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={!repoAllowed}
                              onClick={() => setRepoState("working")}
                            >
                              Inspect sample repository <Icon name="arrow" size={15} />
                            </Button>
                          )}
                          <div className="repo-controls">
                            <button onClick={() => setRepoState("error")}>
                              Simulate access failure
                            </button>
                            <button
                              onClick={() => {
                                setRepoAllowed(false);
                                setRepoState("choose");
                                setToast(
                                  "Sample repository disconnected. Your draft is preserved.",
                                );
                              }}
                            >
                              Disconnect
                            </button>
                          </div>
                        </div>
                      )}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (
                            [draft.title, draft.problem, draft.description].some(
                              (value) => !value.trim(),
                            )
                          ) {
                            setToast(
                              "Add a project name, problem and description before continuing.",
                            );
                            return;
                          }
                          setStep(1);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <Field label="Project name" htmlFor="title">
                          <TextInput
                            id="title"
                            value={draft.title}
                            onChange={(e) => update("title", e.target.value)}
                            placeholder="Give your idea a name"
                            required
                            maxLength={120}
                          />
                        </Field>
                        <Field
                          label="What problem does it solve?"
                          htmlFor="problem"
                          hint="Who is it for, and what gets easier?"
                        >
                          <textarea
                            id="problem"
                            value={draft.problem}
                            onChange={(e) => update("problem", e.target.value)}
                            placeholder="I kept running into…"
                            required
                            maxLength={1000}
                            rows={3}
                            aria-describedby="problem-hint"
                          />
                        </Field>
                        <Field
                          label="What did you build?"
                          htmlFor="description"
                          hint="A few concrete sentences help the right people find you."
                        >
                          <textarea
                            id="description"
                            value={draft.description}
                            onChange={(e) => update("description", e.target.value)}
                            placeholder="Here’s what it does and how it works…"
                            required
                            maxLength={10000}
                            rows={5}
                            aria-describedby="description-hint"
                          />
                        </Field>
                        <Field label="One useful thing to take away (optional)" htmlFor="takeaway">
                          <TextInput
                            id="takeaway"
                            value={draft.takeaway}
                            onChange={(e) => update("takeaway", e.target.value)}
                            placeholder="A pattern, a surprising lesson, a clever little detail"
                            maxLength={400}
                          />
                        </Field>
                        <Field label="What doesn’t it do yet? (optional)" htmlFor="limitation">
                          <textarea
                            id="limitation"
                            value={draft.limitation}
                            onChange={(e) => update("limitation", e.target.value)}
                            placeholder="An honest limitation is useful too."
                            rows={2}
                            maxLength={2000}
                          />
                        </Field>
                        <div className="form-actions">
                          <span className="small muted">
                            Draft kept while this preview stays open.
                          </span>
                          <Button type="submit">
                            Your details <Icon name="arrow" size={17} />
                          </Button>
                        </div>
                      </form>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <div className="section-title">
                        <span>02</span>
                        <h2>Put a person behind the project</h2>
                      </div>
                      <p className="panel-intro">
                        Help someone who finds your work start a conversation.
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (
                            !draft.name.trim() ||
                            !draft.contact.trim() ||
                            !draft.recoveryEmail.trim()
                          )
                            return;
                          if (draft.contactKind === "profile") {
                            try {
                              if (new URL(draft.contact).protocol !== "https:") throw new Error();
                            } catch {
                              setToast("Use an HTTPS URL for your public profile.");
                              return;
                            }
                          }
                          setStep(2);
                          setReviewed(false);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <Field label="Public display name" htmlFor="name">
                          <TextInput
                            id="name"
                            value={draft.name}
                            onChange={(e) => update("name", e.target.value)}
                            placeholder="Alex Builder"
                            required
                            maxLength={100}
                          />
                        </Field>
                        <Field label="How can people reach you?" htmlFor="contact-kind">
                          <select
                            id="contact-kind"
                            className="text-input"
                            value={draft.contactKind}
                            onChange={(e) => update("contactKind", e.target.value)}
                          >
                            <option value="email">Public email address</option>
                            <option value="profile">Public profile link</option>
                          </select>
                        </Field>
                        <Field
                          label={
                            draft.contactKind === "email"
                              ? "Public contact email"
                              : "Public profile URL"
                          }
                          htmlFor="contact"
                          hint="Visible to everyone who views your project, including agents."
                        >
                          <TextInput
                            id="contact"
                            type={draft.contactKind === "email" ? "email" : "url"}
                            value={draft.contact}
                            onChange={(e) => update("contact", e.target.value)}
                            placeholder={
                              draft.contactKind === "email"
                                ? "alex@example.com"
                                : "https://example.com/alex"
                            }
                            required
                            maxLength={500}
                            aria-describedby="contact-hint"
                          />
                        </Field>
                        <div className="private-fields">
                          <div className="eyebrow">
                            <Icon name="lock" size={14} /> ONLY FOR YOUR ACCESS
                          </div>
                          <Field
                            label="Private recovery email"
                            htmlFor="recovery"
                            hint="Used for verification and editing access. Not shown on your project."
                          >
                            <TextInput
                              id="recovery"
                              type="email"
                              value={draft.recoveryEmail}
                              onChange={(e) => update("recoveryEmail", e.target.value)}
                              placeholder="private@example.com"
                              required
                              maxLength={254}
                              aria-describedby="recovery-hint"
                            />
                          </Field>
                        </div>
                        <div className="form-actions">
                          <Button variant="quiet" type="button" onClick={() => setStep(0)}>
                            <Icon name="back" size={16} />
                            Your project
                          </Button>
                          <Button type="submit">
                            Review your project <Icon name="arrow" size={17} />
                          </Button>
                        </div>
                      </form>
                    </>
                  )}
                </div>
                <aside className="editor-note">
                  <p className="eyebrow">A GOOD DESCRIPTION OPENS DOORS</p>
                  <h3>Specific beats impressive.</h3>
                  <ul>
                    <li>The problem you actually had.</li>
                    <li>The small thing you made work.</li>
                    <li>The detail someone else could use.</li>
                  </ul>
                  <p>You don’t need a polished launch, a public repo, or a grand ambition.</p>
                  <div className="note-divider" />
                  <Icon name="pin" size={18} />
                  <p>
                    Sharing with
                    <br />
                    <strong>AI Builders Bratislava</strong>
                  </p>
                  <p className="small muted">
                    Prototype only. Use sample details. Your input stays in this tab and disappears
                    on reload.
                  </p>
                </aside>
              </div>
            ) : (
              <div className="review-layout">
                <div className="review-header">
                  <div>
                    <p className="eyebrow">03 / YOUR PUBLIC PREVIEW</p>
                    <h2>Here’s what people will see.</h2>
                    <p>The description and contact below will also be readable by agents.</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setStep(0);
                      setReviewed(false);
                    }}
                  >
                    <Icon name="back" size={16} />
                    Edit project
                  </Button>
                </div>
                <div className="review-card">
                  <div className="detail-grid">
                    <ProjectStory project={preview} />
                    <AuthorCard author={preview.author} />
                  </div>
                </div>
                <div className="publication-panel">
                  <div>
                    <h3>A quick check, then share.</h3>
                    <p>
                      <Icon name="lock" size={15} />
                      Your recovery email and private repository details are excluded from this
                      preview.
                    </p>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      <span>I’ve reviewed the project and the public contact details above.</span>
                    </label>
                  </div>
                  <div className="verification-panel">
                    <span className="simulation-label">DEMO VERIFICATION · NO EMAIL IS SENT</span>
                    {verified ? (
                      <p className="verified">
                        <Icon name="check" size={18} />
                        Email ownership simulated
                      </p>
                    ) : verificationSent ? (
                      <>
                        <p>In the live app, you would open a link in your inbox.</p>
                        <Button variant="secondary" onClick={() => setVerified(true)}>
                          Simulate opening the email link
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onClick={() => setVerificationSent(true)}>
                        Try email verification <Icon name="mail" size={16} />
                      </Button>
                    )}
                    <Button disabled={!reviewed || !verified} onClick={publish}>
                      Share in this preview <Icon name="arrow" size={17} />
                    </Button>
                    <span className="small muted">Adds a card to this tab only.</span>
                  </div>
                </div>
                <button className="text-back" onClick={() => setStep(1)}>
                  <Icon name="back" size={16} />
                  Edit your details
                </button>
              </div>
            )}
          </div>
        )}

        {view === "agents" && (
          <div className="page-shell agents-page">
            <p className="eyebrow">
              <Icon name="terminal" size={16} /> FOR THE AGENT IN YOUR EDITOR
            </p>
            <h1>
              Find the useful bit.
              <br />
              <span>Keep building.</span>
            </h1>
            <p className="hero-copy">
              Your agent knows your project. The catalog gives it a place to look for something that
              could help.
            </p>
            <div className="agent-prompt">
              <span className="eyebrow">A PROMPT TO TRY WHEN THE SERVICE IS LIVE</span>
              <p>
                “Look on brag.codes for projects or patterns that could help with what we’re
                building. Explain the fit, what’s unknown, and who made it.”
              </p>
              <Button
                variant="secondary"
                onClick={() =>
                  copy(
                    "Look on brag.codes for projects or patterns that could help with what we’re building. Explain the fit, what’s unknown, and who made it.",
                  )
                }
              >
                <Icon name="copy" size={16} />
                Copy prompt
              </Button>
            </div>
            <div className="agent-columns">
              <section>
                <span className="number-label">01</span>
                <h2>Search the public work</h2>
                <p>
                  Send a small problem brief. Your local source code can stay in your own workspace.
                </p>
              </section>
              <section>
                <span className="number-label">02</span>
                <h2>Check the evidence</h2>
                <p>
                  Get descriptions, limitations and provenance. A description-only project can be
                  the right match.
                </p>
              </section>
              <section>
                <span className="number-label">03</span>
                <h2>Meet the builder</h2>
                <p>
                  Every public record includes the author’s chosen contact. Private repository
                  access remains separate.
                </p>
              </section>
            </div>
            <div className="notice">
              <Icon name="code" />
              <div>
                <strong>Explore the record format now.</strong>
                <p>
                  The production API and agent connection are planned. This preview can show the
                  public JSON for each fictional project.
                </p>
                <Button
                  variant="quiet"
                  onClick={() => {
                    go("project/fieldnotes");
                  }}
                >
                  Open a sample project <Icon name="arrow" size={16} />
                </Button>
              </div>
            </div>
          </div>
        )}

        {view === "catalogue" && (
          <div className="page-shell catalogue-page">
            <p className="eyebrow">SHARED UI CATALOGUE</p>
            <h1>The pieces of brag.codes.</h1>
            <p className="hero-copy">
              The prototype uses these same components. Application behavior and integrations will
              be added separately.
            </p>
            <a href="#legal/privacy">Privacy Policy and Terms of Service</a>
            <OptionalEventPreviewLink onOpen={() => go("optional-event")} />
            <MobilePreviewLink onOpen={() => go("mobile")} />
            <ModerationPreviewLink onOpen={() => go("moderation")} />
            <PitchRecoveryPreviewLink onOpen={() => go("recovery")} />
            <PublicationLifecyclePreviewLink onOpen={() => go("publication-lifecycle")} />
            <GalleryPreviewLink onOpen={() => go("gallery")} />
            <ProjectDeletionPreviewLink onOpen={() => go("delete-project")} />
            <DraftAgentPreviewLink onOpen={() => go("refine")} />
            <SharePreviewLink onOpen={() => go("share/home")} />
            <PublicationPreviewLink onOpen={() => go("publish/start")} />
            <div className="catalogue-access-link">
              <h2>Sign-in and mobile admin flow</h2>
              <p>
                Sign in, open Admin from the account menu, then scan or paste an example event QR,
                review its submission window and whitelist it. Includes ordinary-user denial,
                duplicate events, role revocation and session expiry.
              </p>
              <Button onClick={() => go("access/home")}>Open login and admin flow</Button>
            </div>
            <div className="catalogue-demo">
              <div>
                <h2>Actions and labels</h2>
                <div className="tag-list">
                  <Button onClick={() => setToast("Primary action example.")}>
                    Primary <Icon name="arrow" size={16} />
                  </Button>
                  <Button variant="secondary" onClick={() => setToast("Secondary action example.")}>
                    Secondary
                  </Button>
                  <Button disabled>Disabled</Button>
                </div>
                <div className="tag-list">
                  <Tag>TypeScript</Tag>
                  <Tag tone="green">Daily use</Tag>
                  <Tag tone="coral">Preview</Tag>
                </div>
                <Field label="Example field" htmlFor="sample-field">
                  <TextInput id="sample-field" placeholder="A useful detail" />
                </Field>
              </div>
              <ProjectCard
                project={seedProjects[0]}
                saved={saved.includes(seedProjects[0].id)}
                onSave={() => save(seedProjects[0])}
                onOpen={() => go("project/fieldnotes")}
              />
            </div>
            <div className="registry-list">
              {componentRegistry.map((item) => (
                <div key={item.id}>
                  <code>{item.id}</code>
                  <strong>{item.name}</strong>
                  <span>{item.purpose}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {view &&
          !["saved", "submit", "agents", "catalogue"].includes(view) &&
          !view.startsWith("project/") && (
            <div className="page-shell">
              <EmptyState
                title="That page isn’t in this preview."
                action={<Button onClick={() => go("")}>Discover projects</Button>}
              >
                Head back to the collection of things people are building.
              </EmptyState>
            </div>
          )}
      </main>
      <footer className="site-footer">
        <div>
          <a className="footer-brand" href="#">
            brag.codes <span>↗</span>
          </a>
          <span>Built something? There’s someone for that.</span>
        </div>
        <nav aria-label="Footer">
          <a href="#catalogue">UI catalogue</a>
          <a href="#agents">
            For agents <Icon name="arrow" size={13} />
          </a>
          <span>Made for the curious.</span>
        </nav>
      </footer>
      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">
        {toast && (
          <>
            <Icon name="check" size={17} />
            {toast}
          </>
        )}
      </div>
      <dialog ref={resetRef} className="reset-dialog" aria-labelledby="reset-title">
        <h2 id="reset-title">Start fresh?</h2>
        <p>
          This clears your draft, saved projects and preview publication. The fictional sample
          projects will return.
        </p>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => resetRef.current?.close()}>
            Keep exploring
          </Button>
          <Button onClick={reset}>Reset preview</Button>
        </div>
      </dialog>
    </>
  );
}

function EventCard({ onBrowse }: { onBrowse: () => void }) {
  return (
    <aside className="event-ticket">
      <div className="event-ticket-top">
        <span className="event-status">
          <span /> IN THE ROOM
        </span>
        <span className="event-number">MEETUP / 006</span>
      </div>
      <div className="event-ticket-main">
        <div>
          <span className="event-city">BRATISLAVA</span>
          <h2>
            AI Builders
            <br />& curious minds.
          </h2>
          <p>
            Good conversations start with
            <br />
            “let me show you what I made.”
          </p>
        </div>
        <div className="event-date">
          <span>NOV</span>
          <strong>06</strong>
          <span>FRIDAY</span>
        </div>
      </div>
      <div className="ticket-perforation" />
      <div className="event-ticket-bottom">
        <span>
          <Icon name="pin" size={14} />
          Bratislava · 18:00
        </span>
        <button onClick={onBrowse}>
          Explore the room <Icon name="arrow" size={16} />
        </button>
      </div>
    </aside>
  );
}
