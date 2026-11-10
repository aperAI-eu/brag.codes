import { BrandLogo, PromptFlag } from "./brand";
import type { ReactNode, RefObject } from "react";
import { AccountMenu, type AccountSummary } from "./access";
import { Button, EmptyState, Icon, Tag } from "./components";

export type LinkedEvent = {
  id: string;
  title: string;
  starts: string;
  from: string;
  to: string;
  timezone: string;
  location: string;
  state: "open" | "scheduled" | "closed" | "suspended";
};
export type OwnProject = {
  id: string;
  eventId: string | null;
  title: string;
  updated: string;
  saved: boolean;
  published?: boolean;
  publicationState?: "published" | "withdrawn" | "hidden" | null;
  legacy?: boolean;
  unfinished: boolean;
  status: string;
  method: "Typed" | "Voice" | "Agent";
};
export type ProjectFilter = "all" | "saved" | "unfinished";
export type ShareDestination = "home" | "events" | "projects" | "account" | "scan" | "slop";
const labels = {
  open: "Submissions open",
  scheduled: "Not open yet",
  closed: "Submissions closed",
  suspended: "Event unavailable",
};

export function ShareShell({
  user,
  mainRef,
  menuRef,
  onNavigate,
  onSignIn,
  onSignOut,
  children,
}: {
  user: AccountSummary | null;
  mainRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLDetailsElement | null>;
  onNavigate: (route: ShareDestination) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="share-shell">
      <a
        className="skip-link"
        href="#share-main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="access-header">
        <a
          className="brand"
          href="#share/home"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("home");
          }}
        >
          <BrandLogo />
        </a>
        {user ? (
          <AccountMenu
            user={user}
            canAdmin={false}
            menuRef={menuRef}
            onNavigate={(route) => onNavigate(route === "admin" ? "home" : route)}
            onSignOut={onSignOut}
          />
        ) : (
          <Button variant="quiet" onClick={onSignIn}>
            Sign in
          </Button>
        )}
      </header>
      <main id="share-main" className="access-main" tabIndex={-1} ref={mainRef}>
        {children}
      </main>
    </div>
  );
}

export function ShareHomeView({
  user,
  liveEvents,
  projectCount,
  eventCount,
  onShare,
  onNavigate,
}: {
  user: AccountSummary | null;
  liveEvents: LinkedEvent[];
  projectCount: number;
  eventCount: number;
  onShare: () => void;
  onNavigate: (route: ShareDestination) => void;
}) {
  return (
    <section className="share-home">
      <PromptFlag />
      <p className="eyebrow">SHARE WHAT YOU BUILT</p>
      <h1>
        Built something?
        <br />
        Brag about it.
      </h1>
      <p className="muted">A project, an experiment, a useful idea. Give it a home.</p>
      <Button onClick={onShare}>
        Share your work <Icon name="arrow" size={20} />
      </Button>
      <p className="share-context small" role="status">
        {!user
          ? "Sign in and tell us what you built. Linking an event is optional."
          : liveEvents.length === 0
            ? "Share on your own, or link an event using its QR."
            : liveEvents.length === 1
              ? `Ready to share at ${liveEvents[0].title}.`
              : `${liveEvents.length} linked events are accepting submissions. Choose one when you share.`}
      </p>
      {user && (
        <nav className="share-shortcuts" aria-label="Your work">
          <Button variant="secondary" onClick={() => onNavigate("projects")}>
            <Icon name="layers" size={20} /> My projects <span>{projectCount}</span>
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("events")}>
            <Icon name="pin" size={20} /> My events <span>{eventCount}</span>
          </Button>
          <Button variant="quiet" onClick={() => onNavigate("scan")}>
            <Icon name="grid" size={18} /> Scan another event
          </Button>
        </nav>
      )}
      <Button variant="secondary" onClick={() => onNavigate("slop")}>
        Slop Gallery <Icon name="search" size={18} />
      </Button>
    </section>
  );
}

function EventFacts({ event }: { event: LinkedEvent }) {
  return (
    <>
      <Tag tone={event.state === "open" ? "green" : "neutral"}>{labels[event.state]}</Tag>
      <p className="muted">
        {event.starts} · {event.location}
      </p>
      <dl className="share-window">
        <div>
          <dt>From</dt>
          <dd>{event.from}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{event.to}</dd>
        </div>
      </dl>
      <p className="small muted">{event.timezone} · brag.codes submission window</p>
    </>
  );
}

export function LinkedEventsView({
  events,
  choosing,
  onChoose,
  onScan,
  onHome,
}: {
  events: LinkedEvent[];
  choosing: boolean;
  onChoose: (id: string) => void;
  onScan: () => void;
  onHome: () => void;
}) {
  return (
    <section className="share-list">
      <Button variant="quiet" onClick={onHome}>
        <Icon name="back" size={18} /> Back to brag
      </Button>
      <h1>{choosing ? "Which event is this for?" : "My events"}</h1>
      <p className="muted">
        {choosing
          ? "Choose an event that is accepting submissions."
          : "Your linked events. Past projects stay yours when submissions close."}
      </p>
      {events.length === 0 && (
        <EmptyState
          title="No events linked yet."
          action={<Button onClick={onScan}>Scan event QR</Button>}
        >
          Scan an approved event QR to link it to your account.
        </EmptyState>
      )}
      {events.map((event) => (
        <article key={event.id} className="access-card share-event" aria-label={event.title}>
          <h2>{event.title}</h2>
          <EventFacts event={event} />
          <Button
            variant={choosing ? "primary" : "secondary"}
            disabled={event.state !== "open"}
            onClick={() => onChoose(event.id)}
          >
            {choosing ? "Choose this event" : "Share at this event"}
          </Button>
        </article>
      ))}
      {events.length > 0 && (
        <Button variant="quiet" onClick={onScan}>
          Scan another event
        </Button>
      )}
    </section>
  );
}

export function EventLinkedView({
  event,
  repeated,
  resumePending = false,
  onContinue,
  onScan,
  onHome,
}: {
  event: LinkedEvent;
  repeated: boolean;
  resumePending?: boolean;
  onContinue: () => void;
  onScan: () => void;
  onHome: () => void;
}) {
  return (
    <section className="access-card share-event">
      <p className="eyebrow">{repeated ? "ALREADY LINKED" : "EVENT LINKED"}</p>
      <h1>{event.title}</h1>
      <EventFacts event={event} />
      <p>
        {event.state === "open"
          ? "This event is linked to your account. You can share several projects here."
          : event.state === "scheduled"
            ? `Submissions open ${event.from}. You can find this event in My events.`
            : "New submissions are unavailable. Your saved projects remain in My projects."}
      </p>
      {event.state === "open" && (
        <Button onClick={onContinue}>
          {resumePending ? "Resume unfinished project" : "Continue to project options"}
        </Button>
      )}
      {resumePending && (
        <p className="small muted">
          Finish your unfinished project in its original event before starting another. Linking this
          event does not move that project.
        </p>
      )}
      <Button variant="secondary" onClick={onHome}>
        Back to brag
      </Button>
      <Button variant="quiet" onClick={onScan}>
        Scan another event
      </Button>
    </section>
  );
}

export function OwnProjectsView({
  projects,
  events,
  filter,
  onFilter,
  onOpen,
  onShare,
  onHome,
}: {
  projects: OwnProject[];
  events: LinkedEvent[];
  filter: ProjectFilter;
  onFilter: (filter: ProjectFilter) => void;
  onOpen: (id: string) => void;
  onShare: () => void;
  onHome: () => void;
}) {
  const visible = projects.filter((project) => filter === "all" || project[filter]);
  return (
    <section className="share-list">
      <Button variant="quiet" onClick={onHome}>
        <Icon name="back" size={18} /> Back to brag
      </Button>
      <h1>My projects</h1>
      <p className="muted">Your projects and private drafts. Nothing is published automatically.</p>
      <div className="share-filters" role="group" aria-label="Project filters">
        {(["all", "saved", "unfinished"] as const).map((value) => (
          <Button
            key={value}
            variant={filter === value ? "primary" : "secondary"}
            aria-pressed={filter === value}
            onClick={() => onFilter(value)}
          >
            {value === "all" ? "All" : value === "saved" ? "Saved" : "Unfinished"}{" "}
            {projects.filter((project) => value === "all" || project[value]).length}
          </Button>
        ))}
      </div>
      <p className="small muted">
        Saved projects with new work awaiting review also appear in Unfinished. All counts each
        project once.
      </p>
      {projects.length > 0 && visible.length === 0 && (
        <p role="status">No projects in this view.</p>
      )}
      {projects.length === 0 && (
        <EmptyState
          title="Your first project starts here."
          action={<Button onClick={onShare}>Share your work</Button>}
        >
          Tell us what you built, with or without an event.
        </EmptyState>
      )}
      {[...events, { id: null, title: "No event linked", state: null }]
        .filter((event) => visible.some((project) => project.eventId === event.id))
        .map((event) => (
          <section
            className="share-project-group"
            key={event.id ?? "no-event"}
            aria-label={event.title}
          >
            <ul>
              {visible
                .filter((project) => project.eventId === event.id)
                .map((project) => (
                  <li className="share-project-card" key={project.id}>
                    <h2>
                      <Button variant="quiet" onClick={() => onOpen(project.id)}>
                        <span>{project.title || "Untitled project"}</span>
                        <Icon name="arrow" size={20} />
                      </Button>
                    </h2>
                    <div className="share-project-tags">
                      <Tag>{event.title}</Tag>
                      {event.state && (
                        <Tag tone={event.state === "open" ? "green" : "neutral"}>
                          {labels[event.state]}
                        </Tag>
                      )}
                    </div>
                    <span className="small muted">
                      {project.published
                        ? "Published project"
                        : project.publicationState === "withdrawn"
                          ? "Withdrawn project"
                          : project.publicationState === "hidden"
                            ? "Hidden project"
                            : project.legacy
                              ? "Existing draft"
                              : project.saved
                                ? "Saved private draft"
                                : "Not yet saved"}
                      {project.legacy && project.status === "Existing draft"
                        ? ""
                        : ` · ${project.status}`}{" "}
                      · {project.method} · Updated {project.updated}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      {projects.length > 0 && <Button onClick={onShare}>Share your work</Button>}
    </section>
  );
}

export function ShareMessageView({
  title,
  message,
  action,
  onAction,
  onHome,
}: {
  title: string;
  message: string;
  action?: string;
  onAction?: () => void;
  onHome: () => void;
}) {
  return (
    <section className="access-card">
      <h1>{title}</h1>
      <p className="muted" role="status">
        {message}
      </p>
      {action && onAction && <Button onClick={onAction}>{action}</Button>}
      <Button variant="secondary" onClick={onHome}>
        Back to brag
      </Button>
    </section>
  );
}

export function SharePreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="catalogue-access-link">
      <h2>Share your work · proposed journey</h2>
      <p>
        Sign in, link or choose a live event, then save independent projects. Review empty states,
        closed windows and your projects grouped by event.
      </p>
      <Button onClick={onOpen}>Open Share your work preview</Button>
    </section>
  );
}

export function RetainedProjectView({
  onResume,
  onDiscard,
}: {
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="access-card">
      <h2>Your unfinished project is here.</h2>
      <p className="muted">
        The text and review progress are kept in this tab. Finish this project before starting
        another.
      </p>
      <Button onClick={onResume}>Resume unfinished project</Button>
      <Button variant="quiet" onClick={onDiscard}>
        Discard unsaved project
      </Button>
    </section>
  );
}
