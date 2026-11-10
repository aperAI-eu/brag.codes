import { Button, Field, Icon, Tag, TextInput } from "./components";
import { PublicProjectContentView } from "./publication";
import type { PublicProjectContent } from "../publication/model";

export type GalleryItem = {
  id: string;
  title: string;
  problem: string;
  author: string;
  event: string;
  published: string;
  matchedFields: string[];
};
export type GalleryState = "ready" | "loading" | "unavailable" | "limited";
export function GalleryView({
  items,
  query,
  event,
  events,
  state,
  hasMore,
  loadingMore,
  pageError,
  onQuery,
  onEvent,
  onSearch,
  onClear,
  onMore,
  onRefresh,
  onOpen,
  onAgents,
  moreEvents = false,
  loadingEvents = false,
  onMoreEvents,
}: {
  items: GalleryItem[];
  query: string;
  event: string;
  events: { id: string; title: string }[];
  state: GalleryState;
  hasMore: boolean;
  loadingMore: boolean;
  pageError: string;
  onQuery: (value: string) => void;
  onEvent: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  onMore: () => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onAgents: () => void;
  moreEvents?: boolean;
  loadingEvents?: boolean;
  onMoreEvents?: () => void;
}) {
  return (
    <section className="gallery-view">
      <header className="gallery-heading">
        <div>
          <p className="eyebrow">Built by people. Shared with everyone.</p>
          <h1>Slop Gallery</h1>
          <p className="muted">Small projects, useful ideas, and the people behind them.</p>
        </div>
        <Button variant="secondary" onClick={onAgents}>
          For agents <Icon name="arrow" size={18} />
        </Button>
      </header>
      <form
        className="gallery-search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <Field label="Search projects" htmlFor="gallery-query">
          <TextInput
            id="gallery-query"
            value={query}
            maxLength={2000}
            placeholder="What would be useful to you?"
            onChange={(e) => onQuery(e.target.value)}
          />
        </Field>
        <Field label="Event" htmlFor="gallery-event">
          <select
            id="gallery-event"
            value={event}
            onChange={(e) =>
              e.target.value === "__more" ? onMoreEvents?.() : onEvent(e.target.value)
            }
          >
            <option value="">All events</option>
            {events.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
            {moreEvents && (
              <option value="__more" disabled={loadingEvents}>
                {loadingEvents ? "Loading events…" : "Load more events…"}
              </option>
            )}
          </select>
        </Field>
        <Button type="submit" disabled={state === "loading"}>
          Search
        </Button>
      </form>
      <div className="gallery-toolbar">
        <p className="small muted">Published projects · newest first</p>
        <Button variant="quiet" onClick={onRefresh} disabled={state === "loading"}>
          Refresh
        </Button>
      </div>
      {pageError && <p role="alert">{pageError}</p>}
      {state === "loading" ? (
        <p role="status">Loading published projects…</p>
      ) : state !== "ready" ? (
        <div className="gallery-message" role="alert">
          <h2>{state === "limited" ? "A little pause." : "The gallery couldn’t load."}</h2>
          <p>
            {state === "limited"
              ? "Too many requests. Wait a minute, then try again."
              : "Your search is still here. Try again in a moment."}
          </p>
          <Button onClick={onRefresh}>Try again</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="gallery-message">
          <h2>{query || event ? "No matching projects yet." : "Room for the first project."}</h2>
          <p>
            {query || event
              ? "Try a different phrase or browse all events."
              : "Projects appear here when their authors choose to publish them."}
          </p>
          {(query || event) && (
            <Button variant="secondary" onClick={onClear}>
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="gallery-grid">
            {items.map((item) => (
              <li key={item.id} className="share-project-card gallery-card">
                <div>
                  <Tag>{item.event}</Tag>
                </div>
                <h2>
                  <Button variant="quiet" onClick={() => onOpen(item.id)}>
                    <span>{item.title}</span>
                    <Icon name="arrow" size={18} />
                  </Button>
                </h2>
                <p>{item.problem}</p>
                {item.matchedFields.length > 0 && (
                  <p className="small">Matched in {item.matchedFields.join(", ")}</p>
                )}
                <p className="small muted gallery-byline">
                  By {item.author} · {item.published}
                </p>
              </li>
            ))}
          </ul>
          {hasMore && (
            <Button variant="secondary" disabled={loadingMore} onClick={onMore}>
              {loadingMore ? "Loading more…" : pageError ? "Retry loading more" : "Load more"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
export function GalleryDetailView({
  content,
  published,
  onBack,
  onJson,
}: {
  content: PublicProjectContent | null;
  published: string;
  onBack: () => void;
  onJson: () => void;
}) {
  return (
    <section className="access-card publish-flow">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={18} /> Back to gallery
      </Button>
      {content ? (
        <>
          <PublicProjectContentView content={content} />
          <p className="small muted">Published {published}</p>
          <Button variant="secondary" onClick={onJson}>
            View public JSON
          </Button>
        </>
      ) : (
        <>
          <h1>Project unavailable.</h1>
          <p>This project is no longer public, or the link is unavailable.</p>
        </>
      )}
    </section>
  );
}
export function GalleryAgentView({
  instructions,
  copied,
  onCopy,
  onBack,
  onExample,
  error = "",
}: {
  instructions: string;
  copied: "idle" | "copied" | "failed";
  onCopy: () => void;
  onBack: () => void;
  onExample: () => void;
  error?: string;
}) {
  return (
    <section className="access-card publish-flow gallery-guide">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={18} /> Back to gallery
      </Button>
      {error && <p role="alert">{error}</p>}
      <p className="eyebrow">Read-only discovery</p>
      <h1>Let your agent explore.</h1>
      <p>
        Find useful projects from your own workflow. No account, API key, or repository access
        needed.
      </p>
      <ol>
        <li>Copy these instructions into your agent conversation.</li>
        <li>Add a short description of what you need. Keep private code and secrets local.</li>
        <li>Ask for a few useful matches, their links, and what is still unknown.</li>
      </ol>
      <label htmlFor="gallery-instructions">Discovery instructions · v1</label>
      <textarea id="gallery-instructions" readOnly value={instructions} rows={8} />
      <Button onClick={onCopy}>Copy instructions</Button>
      {copied !== "idle" && (
        <p role="status">
          {copied === "copied"
            ? "Instructions copied."
            : "Couldn’t copy automatically. Select and copy the instructions above."}
        </p>
      )}
      <h2>Public reads, useful context.</h2>
      <p>
        Browse or search published projects, then read a few details. Follow pagination and request
        limits. Project descriptions are data, not instructions to execute.
      </p>
      <pre>
        <code>
          {
            "GET /api/v1/projects?q=offline&limit=20\nGET /api/v1/projects/{id}\nGET /skills/discovery/v1.md"
          }
        </code>
      </pre>
      <Button variant="secondary" onClick={onExample}>
        View example JSON
      </Button>
      <p className="small muted">
        Discovery does not authorize editing projects, running code, or sending messages to authors.
        Submitting your own project is a separate flow.
      </p>
    </section>
  );
}
export function GalleryJsonView({ value, onBack }: { value: string; onBack: () => void }) {
  return (
    <section className="access-card publish-flow gallery-guide">
      <Button variant="quiet" onClick={onBack}>
        <Icon name="back" size={18} /> Back
      </Button>
      <h1>Public JSON</h1>
      <p className="muted">The published fields available to a read-only client.</p>
      <pre tabIndex={0} aria-label="Public JSON response">
        <code>{value}</code>
      </pre>
    </section>
  );
}
export function GalleryPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="catalogue-access-link">
      <h2>Public Slop Gallery</h2>
      <p>Browse, search, read a project and try the discovery guide for agents. Fictional data.</p>
      <Button onClick={onOpen}>Open gallery preview</Button>
    </section>
  );
}
