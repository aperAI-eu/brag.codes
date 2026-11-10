import type { EventSummary, ProjectSummary } from "../lib/sharing/queries";
import type { LinkedEvent, OwnProject } from "../ui/share-work";
export function eventView(event: EventSummary): LinkedEvent {
  const date = (s: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: event.timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(s));
  return {
    id: event.id,
    title: event.title,
    timezone: event.timezone,
    starts: date(event.starts_at),
    from: date(event.submissions_open_at),
    to: date(event.submissions_close_at),
    location: "",
    state: event.submission_state,
  };
}
export function projectView(p: ProjectSummary): OwnProject {
  const saved = p.review.confirmed_version !== null || p.review.legacy_record;
  return {
    id: p.id,
    eventId: p.event?.id ?? null,
    title: p.title,
    updated: new Date(p.updated_at).toLocaleDateString("en-GB"),
    saved,
    published: p.published,
    publicationState: p.publication_state,
    legacy: p.review.legacy_record,
    unfinished: !saved || p.review.content_pending || p.review.attention !== null,
    status:
      p.review.attention === "processing"
        ? "Processing"
        : p.review.attention === "review"
          ? "Ready to review"
          : p.review.content_pending
            ? "Awaiting your save"
            : p.review.state === "legacy"
              ? "Existing draft"
              : saved
                ? "Saved"
                : "Not yet saved",
    method: p.pitch ? "Voice" : p.review.attention === "review" ? "Agent" : "Typed",
  };
}
export const destinations = {
  home: "/",
  events: "/my/events",
  projects: "/my/projects",
  account: "/account",
  scan: "/scan",
  slop: "/slop",
};
