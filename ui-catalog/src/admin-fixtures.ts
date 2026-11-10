import type { EventReview, ReviewErrors } from "../../app/src/ui/admin-events";

export type PreviewEvent = {
  id: string;
  title: string;
  url: string;
  zone: string;
  starts: number;
  from: number;
  to: number;
};

export const exampleLink = "https://luma.com/example-demo-night";
export const existingLink = "https://luma.com/example-builders";
export const initialEvent: PreviewEvent = {
  id: "builders",
  title: "Example builders meetup",
  url: existingLink,
  zone: "Europe/Bratislava",
  starts: Date.parse("2026-11-12T17:00:00Z"),
  from: Date.parse("2026-11-12T16:00:00Z"),
  to: Date.parse("2026-11-13T17:00:00Z"),
};

// Deliberately bounded fixture aliases, not the production provider URL normalizer.
export function fixtureLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !["luma.com", "lu.ma"].includes(url.hostname)
    )
      return null;
    const canonical = `https://luma.com${url.pathname.replace(/\/$/, "")}`;
    return [exampleLink, existingLink].includes(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

export function wallTime(instant: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

// Find real instants matching a wall time in the preview's two supported zones.
// A gap or fold must never silently acquire the browser's timezone or an offset.
export function readTime(value: string, zone: string): { instant?: number; error?: string } {
  if (!value) return { error: "Choose a date and time." };
  if (!["UTC", "Europe/Bratislava"].includes(zone))
    return { error: "Choose a supported time zone." };
  const wall = Date.parse(`${value}Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(wall) ||
    wallTime(wall, "UTC") !== value
  )
    return { error: "Choose a valid date and time." };
  const offsets = new Set(
    [-86400000, 0, 86400000].map((delta) => {
      const sample = wall + delta;
      return Date.parse(`${wallTime(sample, zone)}Z`) - sample;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wallTime(instant, zone) === value);
  if (candidates.length === 0)
    return {
      error: "This local time does not exist because the clocks change. Choose another time.",
    };
  if (candidates.length > 1)
    return {
      error:
        "This time occurs twice when the clocks change. In this preview, choose an unambiguous time or use UTC.",
    };
  return { instant: candidates[0] };
}

export function reviewFor(event: PreviewEvent): EventReview {
  return {
    title: event.title,
    url: event.url,
    zone: event.zone,
    starts: wallTime(event.starts, event.zone),
    from: wallTime(event.from, event.zone),
    to: wallTime(event.to, event.zone),
  };
}

export function newReview(url: string): EventReview {
  return reviewFor({ ...initialEvent, title: "Example demo night", url });
}

export function defaultWindow(starts: string, zone: string): Pick<EventReview, "from" | "to"> {
  const parsed = readTime(starts, zone);
  return parsed.instant === undefined
    ? { from: "", to: "" }
    : {
        from: wallTime(parsed.instant - 3600000, zone),
        to: wallTime(parsed.instant + 86400000, zone),
      };
}

export function validateReview(value: EventReview): {
  errors: ReviewErrors;
  event?: Omit<PreviewEvent, "id">;
} {
  const errors: ReviewErrors = {};
  if (!value.title.trim()) errors.title = "Give the event a title.";
  if (value.title.trim().length > 160) errors.title = "Use a title of 160 characters or fewer.";
  const starts = readTime(value.starts, value.zone),
    from = readTime(value.from, value.zone),
    to = readTime(value.to, value.zone);
  for (const [key, parsed] of [
    ["starts", starts],
    ["from", from],
    ["to", to],
  ] as const)
    if (parsed.error) errors[key] = parsed.error;
  if (from.instant !== undefined && to.instant !== undefined && from.instant >= to.instant)
    errors.to = "To must be later than From.";
  if (!fixtureLink(value.url)) errors.form = "Scan or paste one of the example links again.";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    event: {
      title: value.title.trim(),
      url: value.url,
      zone: value.zone,
      starts: starts.instant!,
      from: from.instant!,
      to: to.instant!,
    },
  };
}

export function displayTime(instant: number, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instant);
}
