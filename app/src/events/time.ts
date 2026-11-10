/** Shared wall-clock editing; all admission decisions remain server-side. */
export function validZone(zone: string): boolean {
  try {
    if (zone.length > 100 || !/^[A-Za-z_+\-/]+$/.test(zone)) return false;
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
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
export function readTime(value: string, zone: string): { instant?: number; error?: string } {
  if (!validZone(zone)) return { error: "Choose a valid IANA time zone." };
  const wall = Date.parse(`${value}Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(wall) ||
    wallTime(wall, "UTC") !== value ||
    !/^(20|21)/.test(value)
  )
    return { error: "Choose a valid date and time between 2000 and 2199." };
  const offsets = new Set(
    [-172800000, -86400000, 0, 86400000, 172800000].map((delta) => {
      const sample = wall + delta;
      return Date.parse(`${wallTime(sample, zone)}Z`) - sample;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wallTime(instant, zone) === value);
  if (!candidates.length)
    return { error: "This time does not exist because the clocks change. Choose another time." };
  if (candidates.length > 1)
    return {
      error:
        "This time occurs twice when the clocks change. Choose an unambiguous time or use UTC.",
    };
  return { instant: candidates[0] };
}
export function defaultWindow(starts: string, zone: string) {
  const { instant } = readTime(starts, zone);
  return instant === undefined
    ? { from: "", to: "" }
    : {
        from: wallTime(instant - 3600000, zone),
        to: wallTime(instant + 86400000, zone),
      };
}
export function displayTime(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}
