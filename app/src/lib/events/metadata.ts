import "server-only";
import { Parser } from "htmlparser2";
import { validZone, wallTime } from "../../events/time.ts";
import type { EventMetadata } from "../../events/metadata.ts";
import { normalizeSource, type Source } from "./validation.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};

export function unavailableMetadata(source: Source): EventMetadata {
  return { status: "unavailable", source_url: source.url, fields: {} };
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return;
  let result = "",
    ignored = 0;
  const parser = new Parser({
    onopentag(name) {
      if (["script", "style", "iframe"].includes(name)) ignored++;
    },
    ontext(chunk) {
      if (!ignored) result += chunk;
    },
    onclosetag(name) {
      if (["script", "style", "iframe"].includes(name)) ignored = Math.max(0, ignored - 1);
      if (!ignored && ["p", "div", "li", "br"].includes(name)) result += "\n";
    },
  });
  parser.end(value);
  result = result
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
      "",
    )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!result) return;
  return result.length <= limit ? result : result.slice(0, limit - 1).trimEnd() + "…";
}

function instant(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !/^(20\d\d|21\d\d)-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.0{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return;
  const stamp = Date.parse(value),
    wall = Date.parse(value.slice(0, 16) + "Z");
  if (
    !Number.isFinite(stamp) ||
    !Number.isFinite(wall) ||
    wallTime(wall, "UTC") !== value.slice(0, 16)
  )
    return;
  return new Date(stamp).toISOString();
}
function zone(value: unknown): string | undefined {
  return typeof value === "string" && validZone(value) ? value : undefined;
}
function matches(value: unknown, source: Source): boolean {
  if (typeof value !== "string") return false;
  try {
    return normalizeSource(value, "https://metadata.invalid").key === source.key;
  } catch {
    return false;
  }
}
function location(value: unknown): string | undefined {
  if (Array.isArray(value))
    return value.map(location).filter(Boolean).join("; ").slice(0, 240) || undefined;
  if (typeof value === "string") return text(value, 240);
  const place = record(value),
    address = record(place.address);
  return text(
    [
      ...new Set(
        [
          place.name,
          typeof place.address === "string" ? place.address : undefined,
          address.streetAddress,
          address.addressLocality,
          address.addressRegion,
          address.postalCode,
          address.addressCountry,
        ].filter((v) => typeof v === "string" && v.trim()),
      ),
    ].join(", "),
    240,
  );
}

/** Parse data only. Never evaluate scripts, follow JSON-LD contexts or read guest/ticket fields. */
export function parseEventMetadata(html: string, source: Source): EventMetadata {
  const events: RecordValue[] = [];
  let luma: RecordValue = {},
    script: { kind: string; body: string } | null = null,
    scripts = 0;
  const inspect = (value: unknown, depth = 0) => {
    if (depth > 6 || events.length >= 32) return;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 100)) inspect(child, depth + 1);
      return;
    }
    const item = record(value),
      types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (
      types.some(
        (v) => v === "Event" || v === "https://schema.org/Event" || v === "http://schema.org/Event",
      )
    )
      events.push(item);
    for (const key of ["@graph", "mainEntity"]) if (item[key]) inspect(item[key], depth + 1);
  };
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name !== "script") return;
      const kind =
        attrs.type?.toLowerCase() === "application/ld+json"
          ? "jsonld"
          : source.provider === "luma" && attrs.id === "__NEXT_DATA__"
            ? "luma"
            : "";
      if (kind && ++scripts <= 16) script = { kind, body: "" };
    },
    ontext(chunk) {
      if (script) {
        script.body += chunk;
        if (script.body.length > 512 * 1024) script = null;
      }
    },
    onclosetag(name) {
      if (name !== "script" || !script) return;
      const current = script;
      script = null;
      try {
        const data = JSON.parse(current.body);
        if (current.kind === "jsonld") inspect(data);
        else {
          const initial = record(record(record(record(data).props).pageProps).initialData);
          const event = record(record(initial.data).event);
          if (
            initial.kind === "event" &&
            typeof event.url === "string" &&
            matches(
              event.url.startsWith("https://") ? event.url : `https://luma.com/${event.url}`,
              source,
            ) &&
            event.visibility !== "private"
          )
            luma = event;
        }
      } catch {
        /* Malformed provider metadata leaves manual entry available. */
      }
    },
  });
  parser.end(html);
  const exact = events.filter((item) => matches(item.url, source) || matches(item["@id"], source));
  const item =
    exact.length === 1
      ? exact[0]
      : !exact.length && events.length === 1 && !events[0].url && !events[0]["@id"]
        ? events[0]
        : {};
  const fields: EventMetadata["fields"] = {};
  const candidates = {
    title: text(luma.name, 160) || text(item.name, 160),
    description: text(item.description, 2000),
    location:
      (luma.geo_address_visibility === "public" &&
        text(record(luma.geo_address_info).full_address, 240)) ||
      location(item.location),
    starts_at: instant(luma.start_at) || instant(item.startDate),
    timezone:
      zone(luma.timezone) ||
      zone(item.timezone) ||
      zone(record(item.eventSchedule).scheduleTimezone),
  };
  for (const [key, value] of Object.entries(candidates))
    if (value) fields[key as keyof typeof fields] = value;
  return {
    source_url: source.url,
    fields,
    status:
      fields.title && fields.starts_at && fields.timezone
        ? "loaded"
        : Object.keys(fields).length
          ? "partial"
          : "unavailable",
  };
}
