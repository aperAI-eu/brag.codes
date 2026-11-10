import type { EventMetadata } from "./metadata.ts";
import { defaultWindow, readTime, wallTime } from "./time.ts";

/** Seed a new review once; later input edits and saved records stay under the admin's control. */
export function metadataReview(metadata?: EventMetadata) {
  const fields = metadata?.fields || {};
  let zone = fields.timezone || (fields.starts_at ? "UTC" : "Europe/Bratislava");
  let starts = fields.starts_at ? wallTime(Date.parse(fields.starts_at), zone) : "";
  let bounds = defaultWindow(starts, zone);
  if (
    fields.starts_at &&
    [starts, bounds.from, bounds.to].some((value) => readTime(value, zone).error)
  ) {
    zone = "UTC";
    starts = wallTime(Date.parse(fields.starts_at), zone);
    bounds = defaultWindow(starts, zone);
  }
  let notice =
    !metadata || metadata.status === "unavailable"
      ? "Couldn’t load details from this event page. You can still enter them below."
      : metadata.status === "partial"
        ? "Some details were loaded from the event page. Complete the missing fields and review before whitelisting."
        : "Details loaded from the event page. Review them before whitelisting.";
  if (fields.starts_at && zone === "UTC" && fields.timezone !== "UTC")
    notice +=
      " Times are shown in UTC to preserve the event’s exact start; you can choose a local time zone.";
  return {
    value: {
      title: fields.title || "",
      description: fields.description || "",
      location: fields.location || "",
      zone,
      starts,
      ...bounds,
    },
    notice,
  };
}
