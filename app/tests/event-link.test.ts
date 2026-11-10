import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePastedEventLink } from "../src/events/event-link.ts";
import { EventError, normalizeSource } from "../src/lib/events/validation.ts";

const origin = "https://example.invalid";

test("canonical local event links use only the configured origin and supported path", () => {
  const local = "http://127.0.0.1:3200";
  const id = "00000000-0000-4000-8000-000000000000";
  assert.equal(normalizeSource(`${local}/events/${id}/submit`, local).eventId, id);
  for (const value of [
    `http://127.0.0.1:3201/events/${id}`,
    `${local}/private`,
    `${local}/events/${id}?token=private`,
    `http://luma.com/fixture`,
    `http://example.invalid/events/${id}`,
  ])
    assert.throws(() => normalizeSource(value, local), EventError);
});

test("pasted public event links accept omitted HTTPS and retain canonical provider aliases", () => {
  const examples = [
    ["luma.com/blxy7j09", "https://luma.com/blxy7j09"],
    ["  LU.MA/blxy7j09/  ", "https://luma.com/blxy7j09"],
    ["https://luma.com/blxy7j09", "https://luma.com/blxy7j09"],
    ["meetup.com/builders/events/123", "https://www.meetup.com/builders/events/123/"],
    [
      "eventbrite.com/e/build-night-tickets-123",
      "https://www.eventbrite.com/e/build-night-tickets-123",
    ],
    [
      "example.invalid/events/00000000-0000-4000-8000-000000000000/submit",
      `${origin}/events/00000000-0000-4000-8000-000000000000`,
    ],
  ];
  for (const [input, expected] of examples) {
    assert.equal(normalizePastedEventLink(input, origin).url, expected, input);
    assert.deepEqual(normalizePastedEventLink(input, origin), normalizeSource(expected, origin));
  }
  // This convenience must not change the QR or server contract.
  assert.throws(() => normalizeSource("luma.com/blxy7j09", origin), EventError);
});

test("paste normalization never repairs unsafe schemes, credentials, tickets or unsupported hosts", () => {
  for (const input of [
    "http://luma.com/blxy7j09",
    "javascript:alert(1)",
    "//luma.com/blxy7j09",
    "/luma.com/blxy7j09",
    "luma.com@evil.test/blxy7j09",
    "user:pass@luma.com/blxy7j09",
    "luma.com:444/blxy7j09",
    "luma.com.evil.test/blxy7j09",
    "luma.com/blxy7j09?ticket=private",
    "luma.com/blxy7j09#private",
    "luma.com/%62lxy7j09",
    "luma.com/abc/../blxy7j09",
    "luma.com/abc\\../blxy7j09",
    "luma.com/tickets",
    "luma.com/event/evt-private/tickets",
    "127.0.0.1/private",
    "other.brag.codes/events/00000000-0000-4000-8000-000000000000",
    "",
    "luma.com/blxy7j09" + " ".repeat(2048),
  ])
    assert.throws(() => normalizePastedEventLink(input, origin), EventError, input);
});
