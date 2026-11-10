import type { ManagedEvent, EventList } from "../events/model";
import { displayTime } from "../events/time";
import { Button, Field, Tag, TextInput } from "./components";
export type EventFilters = { query: string; approval: string; submission: string };
export function EventListView({
  data,
  filters,
  busy,
  onFilters,
  onSearch,
  onNext,
  onOpen,
  onAdd,
}: {
  data: EventList;
  filters: EventFilters;
  busy: boolean;
  onFilters: (value: EventFilters) => void;
  onSearch: () => void;
  onNext: () => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section className="access-admin">
      <div className="access-admin-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Events</h1>
        </div>
        <Button onClick={onAdd}>Add event</Button>
      </div>
      <form
        className="event-filters"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <Field label="Search events" htmlFor="event-search">
          <TextInput
            id="event-search"
            value={filters.query}
            maxLength={200}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
          />
        </Field>
        <Field label="Approval" htmlFor="event-approval">
          <select
            className="text-input"
            id="event-approval"
            value={filters.approval}
            onChange={(e) => onFilters({ ...filters, approval: e.target.value })}
          >
            <option value="">All approvals</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <Field label="Submissions" htmlFor="event-state">
          <select
            className="text-input"
            id="event-state"
            value={filters.submission}
            onChange={(e) => onFilters({ ...filters, submission: e.target.value })}
          >
            <option value="">All windows</option>
            <option value="scheduled">Scheduled</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>
          Search / refresh
        </Button>
      </form>
      <div aria-live="polite">
        {busy
          ? "Loading events…"
          : !data.events.length
            ? "No events match. Add an event to get started."
            : `${data.events.length} event(s) on this page.`}
      </div>
      <div className="event-table">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Approval / submissions</th>
              <th>Submission window</th>
              <th>Links</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>{event.title}</strong>
                  <p>{displayTime(event.starts_at, event.timezone)}</p>
                  <p className="small muted">{event.timezone}</p>
                </td>
                <td>
                  <Tag>{event.approval}</Tag>{" "}
                  <Tag tone={event.submission_state === "open" ? "green" : undefined}>
                    {event.submission_state}
                  </Tag>
                </td>
                <td>
                  <p>From {displayTime(event.submissions_open_at, event.timezone)}</p>
                  <p>To {displayTime(event.submissions_close_at, event.timezone)}</p>
                </td>
                <td>{event.aliases.filter((a) => a.state === "approved").length} approved</td>
                <td>
                  <Button
                    variant="secondary"
                    onClick={() => onOpen(event.id)}
                    aria-label={`Manage ${event.title}`}
                  >
                    Manage
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.next_cursor && (
        <Button variant="secondary" disabled={busy} onClick={onNext}>
          Next page
        </Button>
      )}
    </section>
  );
}
export function EventPasteView({
  link,
  busy,
  onLink,
  onPreview,
  onBack,
}: {
  link: string;
  busy: boolean;
  onLink: (value: string) => void;
  onPreview: () => void;
  onBack: () => void;
}) {
  return (
    <section className="access-card admin-flow">
      <Button variant="quiet" onClick={onBack}>
        Back to events
      </Button>
      <p className="eyebrow">ADD AN EVENT · 1 OF 2</p>
      <h1>Paste the event link.</h1>
      <p className="muted">
        Use a public Luma, Meetup or Eventbrite.com event page. We’ll load the available details for
        you to review before whitelisting.
      </p>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          onPreview();
        }}
      >
        <Field
          label="Event link"
          htmlFor="event-link"
          hint="Use the clean public URL, without tracking parameters or a ticket code."
        >
          <TextInput
            id="event-link"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            required
            value={link}
            onChange={(e) => onLink(e.target.value)}
            placeholder="https://luma.com/your-event"
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Loading event details…" : "Review event link"}
        </Button>
      </form>
    </section>
  );
}
export function EventDetailView({
  event,
  reason,
  link,
  busy,
  onReason,
  onLink,
  onEdit,
  onBack,
  onRefresh,
  onAction,
}: {
  event: ManagedEvent;
  reason: string;
  link: string;
  busy: boolean;
  onReason: (value: string) => void;
  onLink: (value: string) => void;
  onEdit: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onAction: (action: string, alias?: ManagedEvent["aliases"][number]) => void;
}) {
  return (
    <section className="access-admin">
      <div className="access-admin-heading">
        <Button variant="quiet" onClick={onBack}>
          Back to events
        </Button>
        <Button variant="secondary" onClick={onRefresh} disabled={busy}>
          Refresh saved event
        </Button>
      </div>
      <article className="access-card access-event">
        <p className="eyebrow">SAVED EVENT · VERSION {event.version}</p>
        <h1>{event.title}</h1>
        <p>
          <Tag>{event.approval}</Tag> <Tag>{event.submission_state}</Tag>
          {event.manually_closed && " · Manually closed"}
        </p>
        <p>
          Starts {displayTime(event.starts_at, event.timezone)} · {event.timezone}
        </p>
        <dl className="access-window">
          <div>
            <dt>From</dt>
            <dd>{displayTime(event.submissions_open_at, event.timezone)}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>{displayTime(event.submissions_close_at, event.timezone)}</dd>
          </div>
        </dl>
        {event.location && <p>{event.location}</p>}
        {event.description && <p className="event-description">{event.description}</p>}
        <Button onClick={onEdit} disabled={busy}>
          Edit event
        </Button>
        {event.approval === "approved" && (
          <a className="admin-source" href={event.canonical_url}>
            Open event page
          </a>
        )}
      </article>
      <section className="access-card access-event">
        <h2>Event controls</h2>
        <Field label="Reason for change" htmlFor="event-action-reason">
          <TextInput
            id="event-action-reason"
            maxLength={300}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="Explain this change"
          />
        </Field>
        <div className="event-actions">
          <Button
            variant="secondary"
            disabled={busy || !reason.trim()}
            onClick={() => onAction(event.manually_closed ? "reopen" : "close")}
          >
            {event.manually_closed ? "Reopen submissions" : "Close submissions now"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !reason.trim()}
            onClick={() => onAction(event.approval === "approved" ? "suspend" : "approve")}
          >
            {event.approval === "approved" ? "Disable event approval" : "Approve event"}
          </Button>
        </div>
        <p className="small muted">
          Closing retains browsing. Disabling approval stops all event entry links. Reopening
          requires To in the future and still respects From.
        </p>
        <h2>Event QR links</h2>
        {event.aliases.map((alias) => (
          <div className="event-alias" key={alias.id}>
            <p className="admin-source">{alias.url}</p>
            <Tag>{alias.state}</Tag>
            <Button
              variant="quiet"
              disabled={busy || !reason.trim()}
              onClick={() =>
                onAction(alias.state === "approved" ? "remove_alias" : "approve_alias", alias)
              }
            >
              {alias.state === "approved" ? "Remove QR link" : "Approve QR link"}
            </Button>
          </div>
        ))}
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            onAction("add_alias");
          }}
        >
          <Field label="Additional event link" htmlFor="event-alias-link">
            <TextInput
              id="event-alias-link"
              type="url"
              maxLength={2048}
              value={link}
              onChange={(e) => onLink(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            type="submit"
            disabled={busy || !reason.trim() || !link.trim()}
          >
            Add link for review
          </Button>
        </form>
        <p className="small muted">
          Removing a link disables that QR. Additional links require separate approval after review.
        </p>
      </section>
      <section className="access-card access-event">
        <h2>Recent changes</h2>
        {event.audit.map((item) => (
          <div key={item.version}>
            <strong>
              {item.action.replaceAll("_", " ")} · version {item.version}
            </strong>
            <p>{item.reason}</p>
            <p className="small muted admin-source">
              {displayTime(item.created_at, event.timezone)} · Account {item.actor_id}
            </p>
          </div>
        ))}
      </section>
    </section>
  );
}
