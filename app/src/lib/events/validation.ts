import { validZone, wallTime } from "../../events/time.ts";
export class EventError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
  ) {
    super(code);
  }
}
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new EventError(400, "invalid_request");
  return value as Record<string, unknown>;
}
export type Source = { provider: string; key: string; url: string; eventId?: string };
/** No network access. Reject undecoded paths, credentials, tickets and unqualified queries. */
export function normalizeSource(value: unknown, origin: string): Source {
  const reject = () => {
    throw new EventError(422, "unsupported_event_url");
  };
  if (typeof value !== "string" || value.length > 2048) return reject();
  const input = value.trim();
  if (/[\s\\%#?]/.test(input) || !/^https?:\/\//i.test(input)) return reject();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return reject();
  }
  if (url.username || url.password || url.hash || url.search || /\/(?:\.|\.\.)\//.test(input))
    return reject();
  const path = url.pathname.replace(/\/$/, "");
  let match: RegExpMatchArray | null;
  if (
    url.origin === origin &&
    (match = path.match(/^\/events\/([a-f0-9-]{36})(?:\/submit)?$/)) &&
    uuid(match[1])
  )
    return {
      provider: "brag",
      key: `brag:${match[1]}`,
      url: `${origin}/events/${match[1]}`,
      eventId: match[1],
    };
  // Only our configured canonical event route may use a local HTTP origin/port.
  // External providers still require HTTPS and the standard port.
  if (url.protocol !== "https:" || url.port) return reject();
  if (
    ["luma.com", "lu.ma"].includes(url.hostname) &&
    (match = path.match(/^\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/))
  ) {
    if (
      /^(discover|home|signin|login|logout|register|ticket|tickets|check-in|checkin|calendar|event|pricing|settings|account|api|admin)$/i.test(
        match[1],
      )
    )
      return reject();
    return { provider: "luma", key: `luma:${match[1]}`, url: `https://luma.com/${match[1]}` };
  }
  if (
    ["meetup.com", "www.meetup.com"].includes(url.hostname) &&
    (match = path.match(/^\/([A-Za-z0-9_-]{1,160})\/events\/([1-9][0-9]{0,19})$/))
  )
    return {
      provider: "meetup",
      key: `meetup:${match[2]}`,
      url: `https://www.meetup.com/${match[1]}/events/${match[2]}/`,
    };
  if (
    ["eventbrite.com", "www.eventbrite.com"].includes(url.hostname) &&
    (match = path.match(/^\/e\/([a-zA-Z0-9-]{1,180}-tickets-)?([1-9][0-9]{0,19})$/))
  )
    return {
      provider: "eventbrite",
      key: `eventbrite:${match[2]}`,
      url: `https://www.eventbrite.com/e/${match[1] || ""}${match[2]}`,
    };
  return reject();
}
export type EventFields = {
  title: string;
  description: string;
  location: string;
  timezone: string;
  startsAt: Date;
  opensAt: Date;
  closesAt: Date;
};
const fieldKeys = [
  "title",
  "description",
  "location",
  "timezone",
  "starts_at",
  "submissions_open_at",
  "submissions_close_at",
];
export function eventFields(input: unknown, previous?: EventFields): EventFields {
  const data = object(input, fieldKeys),
    errors: Record<string, string> = {};
  const text = (key: "title" | "description" | "location" | "timezone", max: number) => {
    const value = data[key] === undefined ? (previous?.[key] ?? "") : data[key];
    if (
      typeof value !== "string" ||
      value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    ) {
      errors[key] = `Use text of at most ${max} characters.`;
      return "";
    }
    return value.trim();
  };
  const title = text("title", 160),
    description = text("description", 2000),
    location = text("location", 240),
    timezone = text("timezone", 100);
  if (!title) errors.title = "Give the event a title.";
  if (!validZone(timezone)) errors.timezone = "Choose a valid IANA time zone.";
  const instant = (key: string, old?: Date) => {
    if (data[key] === undefined && old) return old;
    const value = data[key];
    const pattern = /^(20\d\d|21\d\d)-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(Z|[+-]\d{2}:\d{2})$/;
    if (typeof value !== "string" || !pattern.test(value) || !Number.isFinite(Date.parse(value))) {
      errors[key] = "Choose a valid date and time with an explicit UTC offset (minute precision).";
      return new Date(0);
    }
    const local = value.slice(0, 16),
      stamp = new Date(value),
      offset = value.endsWith("Z") ? "UTC" : timezone;
    if (
      wallTime(Date.parse(`${local}Z`), "UTC") !== local ||
      (!errors.timezone && wallTime(stamp.getTime(), offset) !== local)
    )
      errors[key] = "The date or offset does not match the time zone.";
    return stamp;
  };
  const startsAt = instant("starts_at", previous?.startsAt),
    opensAt = instant("submissions_open_at", previous?.opensAt),
    closesAt = instant("submissions_close_at", previous?.closesAt);
  if (opensAt >= closesAt) errors.submissions_close_at = "To must be later than From.";
  if (Object.keys(errors).length) throw new EventError(422, "invalid_event", errors);
  return { title, description, location, timezone, startsAt, opensAt, closesAt };
}
