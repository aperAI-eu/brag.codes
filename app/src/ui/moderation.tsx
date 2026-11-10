import { displayTime } from "../events/time";
import { Button, EmptyState, Field, Tag, TextInput } from "./components";
import { PublicProjectContentView, type PublicProjectContent } from "./publication";

export type ModerationEntry = {
  id: string;
  content: PublicProjectContent;
  version: number;
  revision: number;
  hidden: boolean;
  withdrawn: boolean;
  history: { id: string; action: string; actor: string; at: string; reason: string }[];
};
export type ModerationFilter = "all" | "published" | "hidden" | "withdrawn";
export type ModerationPhase = "list" | "detail" | "confirm" | "uncertain" | "conflict";
export function moderationVisibility(entry: ModerationEntry): string {
  return entry.hidden
    ? "Hidden by moderation"
    : entry.withdrawn
      ? "Withdrawn by author"
      : "Published";
}

export function ModerationListView({
  entries,
  query,
  filter,
  event,
  events,
  more,
  onQuery,
  onFilter,
  onEvent,
  onOpen,
  onMore,
  onClear,
  onMoreEvents,
}: {
  entries: ModerationEntry[];
  query: string;
  filter: ModerationFilter;
  event: string;
  events: { id: string; title: string }[];
  more: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: ModerationFilter) => void;
  onEvent: (value: string) => void;
  onOpen: (id: string) => void;
  onMore: () => void;
  onClear: () => void;
  onMoreEvents?: () => void;
}) {
  return (
    <section className="access-card publish-flow">
      <p className="eyebrow">ADMIN / MODERATION</p>
      <h1>Review public projects.</h1>
      <p>Manage visibility across brag.codes. Review only content approved for publication.</p>
      <Field label="Search published content" htmlFor="moderation-query">
        <TextInput
          id="moderation-query"
          value={query}
          maxLength={200}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Title, description or public author"
        />
      </Field>
      <Field label="Visibility" htmlFor="moderation-filter">
        <select
          id="moderation-filter"
          value={filter}
          onChange={(e) => onFilter(e.target.value as ModerationFilter)}
        >
          <option value="all">All states</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden</option>
          <option value="withdrawn">Withdrawn by author</option>
        </select>
      </Field>
      <Field label="Event" htmlFor="moderation-event">
        <select id="moderation-event" value={event} onChange={(e) => onEvent(e.target.value)}>
          <option value="">All events</option>
          {events.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </Field>
      {onMoreEvents && (
        <Button variant="secondary" onClick={onMoreEvents}>
          Load more events
        </Button>
      )}
      {entries.length ? (
        entries.map((entry) => (
          <article className="project-delete-section" key={entry.id}>
            <h2>{entry.content.title}</h2>
            <p>
              {entry.content.author.name} · {entry.content.event ?? "No event linked"}
            </p>
            <div className="tag-list">
              <Tag>{moderationVisibility(entry)}</Tag>
              {entry.hidden && entry.withdrawn && <Tag>Also withdrawn by author</Tag>}
            </div>
            <Button variant="secondary" onClick={() => onOpen(entry.id)}>
              Review {entry.content.title}
            </Button>
          </article>
        ))
      ) : (
        <EmptyState
          title="No matching projects"
          action={
            <Button variant="secondary" onClick={onClear}>
              Clear filters
            </Button>
          }
        >
          Only projects with an approved publication appear here.
        </EmptyState>
      )}
      {more && (
        <Button variant="secondary" onClick={onMore}>
          Load more
        </Button>
      )}
    </section>
  );
}

export function ModerationProjectView({
  entry,
  phase,
  reason,
  error,
  busy,
  onReason,
  onBack,
  onAction,
  onCancel,
  onConfirm,
  onCheck,
  onRefresh,
}: {
  entry: ModerationEntry;
  phase: Exclude<ModerationPhase, "list">;
  reason: string;
  error: string;
  busy: boolean;
  onReason: (value: string) => void;
  onBack: () => void;
  onAction: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onCheck: () => void;
  onRefresh: () => void;
}) {
  const restore = entry.hidden;
  return (
    <section className="access-card publish-flow" aria-busy={busy}>
      <p className="eyebrow">ADMIN / PLATFORM-WIDE ACTION</p>
      {phase === "detail" ? (
        <>
          <Button variant="quiet" onClick={onBack}>
            Back to moderation
          </Button>
          <h1>Review project.</h1>
          <div className="tag-list">
            <Tag>{moderationVisibility(entry)}</Tag>
            {entry.hidden && entry.withdrawn && <Tag>Also withdrawn by author</Tag>}
            <Tag>Public version {entry.version}</Tag>
          </div>
          <p className="small muted">Project ID: {entry.id}</p>
          <PublicProjectContentView content={entry.content} preview />
          <section className="project-delete-section">
            <h2>Public visibility</h2>
            <p>
              This action applies across the public page, gallery, event listings and agent access.
              The author's private project stays intact.
            </p>
            <Button onClick={onAction}>{restore ? "Restore project" : "Hide project"}</Button>
          </section>
          <section className="project-delete-section">
            <h2>Moderation history</h2>
            <p className="small muted">Visible to platform administrators only.</p>
            {entry.history.length ? (
              <ol>
                {entry.history.map((item) => (
                  <li key={item.id}>
                    <strong>{item.action}</strong>
                    <p>
                      {item.actor} ·{" "}
                      {/^\d{4}-/.test(item.at) ? displayTime(item.at, "UTC") + " UTC" : item.at}
                    </p>
                    <p>{item.reason}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No moderation actions yet.</p>
            )}
          </section>
        </>
      ) : phase === "uncertain" ? (
        <>
          <h1>Check the result first.</h1>
          <h2>{entry.content.title}</h2>
          <p>
            The response was lost. The action may already be saved. Check the original request
            before making another change.
          </p>
          <Button disabled={busy} onClick={onCheck}>
            Check result
          </Button>
        </>
      ) : phase === "conflict" ? (
        <>
          <h1>This project changed.</h1>
          <p>
            Review the latest visibility before confirming again. Your unsent reason is retained.
          </p>
          <Button onClick={onRefresh}>Review latest state</Button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <h1>{restore ? "Restore this project?" : "Hide this project?"}</h1>
          <h2>{entry.content.title}</h2>
          <Tag>{entry.content.event ?? "No event linked"}</Tag>
          <p>
            {restore
              ? entry.withdrawn
                ? "The author withdrew this project. Removing the moderation restriction will keep it withdrawn and unavailable to visitors and agents."
                : "Removing the moderation restriction makes the approved publication visible again on its public page, gallery, event listings and agent reads."
              : "This hides the project across brag.codes, including its public page, gallery, event listings and agent reads. The author keeps their private project."}
          </p>
          <p className="small muted">
            This does not delete or edit the project. Copies already downloaded by others cannot be
            recalled.
          </p>
          <Field label="Reason" htmlFor="moderation-reason">
            <textarea
              id="moderation-reason"
              value={reason}
              maxLength={1000}
              required
              disabled={busy}
              onChange={(e) => onReason(e.target.value)}
              rows={4}
            />
          </Field>
          <p className="small muted">
            Required · up to 1,000 characters. Recorded with your account and time, visible only to
            platform administrators.
          </p>
          <div className="form-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel and discard reason
            </Button>
            <Button type="submit" disabled={busy || !reason.trim()}>
              {busy ? "Saving…" : restore ? "Confirm restore" : "Confirm hide"}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function ModerationPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      Try platform moderation
    </Button>
  );
}

export function ModerationNavigation({
  active,
  onNavigate,
}: {
  active: "events" | "moderation" | "integrations";
  onNavigate?: (destination: string) => void;
}) {
  return (
    <nav aria-label="Admin">
      {[
        { id: "events", title: "Events", href: "/admin" },
        { id: "integrations", title: "API setup", href: "/admin/integrations" },
        { id: "moderation", title: "Moderation", href: "/admin/moderation" },
      ].map((item, index) => (
        <span key={item.id}>
          {index > 0 && " · "}
          <a
            href={item.href}
            aria-current={active === item.id ? "page" : undefined}
            onClick={
              onNavigate
                ? (e) => {
                    e.preventDefault();
                    onNavigate(item.href);
                  }
                : undefined
            }
          >
            {item.title}
          </a>
        </span>
      ))}
    </nav>
  );
}
