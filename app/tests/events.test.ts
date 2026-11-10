import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSource, eventFields, EventError } from "../src/lib/events/validation.ts";
import { readTime, defaultWindow } from "../src/events/time.ts";
import { admission } from "../src/lib/events/operations.ts";
const origin = "https://example.invalid";
test("provider aliases normalize strictly without accepting tickets, hostile hosts or URL rewrites", () => {
  assert.equal(
    normalizeSource(" https://lu.ma/build-night/ ", origin).key,
    normalizeSource("https://luma.com/build-night", origin).key,
  );
  assert.equal(
    normalizeSource("https://meetup.com/builders/events/123456/", origin).key,
    normalizeSource("https://www.meetup.com/builders/events/123456", origin).key,
  );
  assert.equal(
    normalizeSource("https://www.eventbrite.com/e/build-night-tickets-123456", origin).key,
    "eventbrite:123456",
  );
  for (const url of [
    "http://luma.com/build-night",
    "https://luma.com.evil.test/build-night",
    "https://luma.com@evil.test/build-night",
    "https://user:pass@luma.com/build-night",
    "https://luma.com:444/build-night",
    "https://luma.com/build-night?ticket=secret",
    "https://luma.com/build-night?utm_source=email",
    "https://luma.com/build-night#secret",
    "https://luma.com/abc/../build-night",
    "https://luma.com/%62uild-night",
    "https://luma.com/tickets",
    "https://luma.com/event/evt-secret/tickets",
    "https://www.meetup.com/builders/events/123/rsvp",
    "https://www.eventbrite.com/mytickets",
    "https://127.0.0.1/private",
    "https://luma.com/abc\\../build-night",
    "https://evil.test/events/00000000-0000-4000-8000-000000000000",
  ])
    assert.throws(() => normalizeSource(url, origin), EventError, url);
  assert.throws(() => normalizeSource("x".repeat(2049), origin), EventError);
});
test("elapsed-hour defaults, daylight-saving gaps/folds and half-hour time zones", () => {
  assert.deepEqual(defaultWindow("2027-03-28T01:30", "Europe/Bratislava"), {
    from: "2027-03-28T00:30",
    to: "2027-03-29T02:30",
  });
  assert.match(readTime("2027-03-28T02:30", "Europe/Bratislava").error!, /does not exist/);
  assert.match(readTime("2027-10-31T02:30", "Europe/Bratislava").error!, /twice/);
  assert.equal(
    readTime("2030-01-01T12:00", "Asia/Kolkata").instant,
    Date.parse("2030-01-01T06:30:00Z"),
  );
  assert.ok(readTime("2030-02-30T12:00", "UTC").error);
  assert.ok(readTime("2030-01-01T12:00", "Invalid/Zone").error);
});
const fields = {
  title: "Example",
  timezone: "Europe/Bratislava",
  starts_at: "2030-01-01T18:00:00+01:00",
  submissions_open_at: "2030-01-01T16:00:00Z",
  submissions_close_at: "2030-01-02T17:00:00Z",
};
test("schedule validation enforces explicit offsets, finite bounds and preserves omitted saved bounds", () => {
  const saved = eventFields(fields);
  assert.equal(saved.startsAt.toISOString(), "2030-01-01T17:00:00.000Z");
  assert.deepEqual(
    eventFields({ starts_at: "2030-01-03T17:00:00Z" }, saved).opensAt,
    saved.opensAt,
  );
  for (const patch of [
    { timezone: "invalid" },
    { starts_at: "2030-01-01T18:00:00+02:00" },
    { starts_at: "2030-02-30T17:00:00Z" },
    { starts_at: "2030-01-01T18:00" },
    { submissions_close_at: fields.submissions_open_at },
    { submissions_open_at: null },
    { approved: true },
  ])
    assert.throws(() => eventFields({ ...fields, ...patch }), EventError);
});
test("admission is half-open and cannot be reopened by time or metadata while manually closed", () => {
  const event = { ...eventFields(fields), approval: "approved", manuallyClosed: false };
  assert.equal(admission(event, new Date(event.opensAt.getTime() - 1)), "scheduled");
  assert.equal(admission(event, event.opensAt), "open");
  assert.equal(admission(event, new Date(event.closesAt.getTime() - 1)), "open");
  assert.equal(admission(event, event.closesAt), "closed");
  assert.equal(admission({ ...event, manuallyClosed: true }, event.opensAt), "closed");
  assert.equal(admission({ ...event, approval: "suspended" }, event.opensAt), "closed");
});
