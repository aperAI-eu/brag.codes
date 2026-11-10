import { publicEventProjects } from "../../../lib/publication/reads";
import { PublicEventProjects } from "../../../publication/event-client";
import { notFound } from "next/navigation";
import { database } from "../../../lib/database/client";
import { runtimeConfig } from "../../../lib/config/runtime";
import { readPublicEvent } from "../../../lib/events/operations";
import { EventError, uuid } from "../../../lib/events/validation";
import { displayTime } from "../../../events/time";
export const dynamic = "force-dynamic";
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid(id)) notFound();
  const [db, config] = await Promise.all([database(), runtimeConfig()]);
  try {
    // Direct internal ID lookup is shared with source resolution; configured local HTTP
    // is only used by the development server, never accepted as an external pasted URL.
    const { event } = await readPublicEvent(db, config.origin, id);
    const listing = await publicEventProjects(db, id);
    return (
      <main className="access-main">
        <section className="access-card admin-flow">
          <p className="eyebrow">BRAG EVENT</p>
          <h1>{event.title}</h1>
          <p>
            {displayTime(event.starts_at, event.timezone)} · {event.timezone}
          </p>
          {event.location && <p>{event.location}</p>}
          {event.description && <p className="event-description">{event.description}</p>}
          <h2>Submission window</h2>
          <p>From {displayTime(event.submissions_open_at, event.timezone)}</p>
          <p>To {displayTime(event.submissions_close_at, event.timezone)}</p>
          <p>Submissions: {event.submission_state}.</p>
          <a className="button button-primary" href={`/events/${event.id}/submit`}>
            Share your project
          </a>
        </section>
        <PublicEventProjects
          event={listing.event}
          initial={listing.projects}
          cursor={listing.next_cursor}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof EventError && error.status === 404) notFound();
    throw error;
  }
}
