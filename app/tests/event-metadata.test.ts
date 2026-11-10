import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Resolver } from "node:dns/promises";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { eventPage } from "./event-metadata-fixture.ts";
import { parseEventMetadata } from "../src/lib/events/metadata.ts";
import {
  loadEventMetadata,
  downloadMetadataPage,
  publicIPv4,
} from "../src/lib/events/metadata-fetch.ts";
import { normalizeSource } from "../src/lib/events/validation.ts";
import { metadataReview } from "../src/events/prefill.ts";
const source = normalizeSource("https://luma.com/blxy7j09", "https://example.invalid");
const ld = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;

test("Luma public data seeds local start, location and elapsed-hour window after many unrelated scripts", () => {
  const metadata = parseEventMetadata(eventPage(), source),
    review = metadataReview(metadata);
  assert.equal(metadata.status, "loaded");
  assert.equal(review.value.title, "DevDay Exchange Community Demo Night: Bratislava");
  assert.equal(review.value.zone, "Europe/Prague");
  assert.equal(review.value.starts, "2026-11-09T18:00");
  assert.equal(review.value.from, "2026-11-09T17:00");
  assert.equal(review.value.to, "2026-11-10T18:00");
  assert.equal(review.value.location, "ESET, Aupark Tower, Bratislava, Slovakia");
  assert.equal(review.value.description, "A fixture description for community demos.");
});
test("JSON-LD uses the linked event, sanitizes text, bounds fields and never guesses a zone", () => {
  const html = ld({
    "@graph": [
      { "@type": "Event", url: "https://luma.com/another-event", name: "Wrong event" },
      {
        "@type": "Event",
        url: source.url,
        name: "Build &amp; share",
        startDate: "2030-06-01T18:00:00+02:00",
        description: "<script>stealCookies()</script><p>Safe text</p>" + "x".repeat(3000),
      },
    ],
  });
  const metadata = parseEventMetadata(html, source),
    review = metadataReview(metadata);
  assert.equal(metadata.status, "partial");
  assert.equal(metadata.fields.title, "Build & share");
  assert.ok(!metadata.fields.description!.includes("stealCookies"));
  assert.equal(metadata.fields.description!.length, 2000);
  assert.equal(review.value.zone, "UTC");
  assert.equal(review.value.starts, "2030-06-01T16:00");
  assert.match(review.notice, /UTC/);
  for (const startDate of ["2030-06-01T18:00", "2030-02-30T18:00:00Z", "not-a-date"])
    assert.equal(
      parseEventMetadata(ld({ "@type": "Event", url: source.url, startDate }), source).fields
        .starts_at,
      undefined,
    );
});
test("metadata cannot import a different event, executable content, hidden venue or malformed JSON", () => {
  for (const html of [
    "<script>throw Error('execute')</script>",
    ld({ "@type": "Event", url: "https://luma.com/other", name: "Other" }),
    '<script type="application/ld+json">{bad</script>',
    "<h1>Login</h1>",
  ])
    assert.equal(parseEventMetadata(html, source).status, "unavailable");
  const hidden = eventPage().replace(
    '"geo_address_visibility":"public"',
    '"geo_address_visibility":"private"',
  );
  assert.equal(parseEventMetadata(hidden, source).fields.location, "ESET, Bratislava");
  assert.ok(!parseEventMetadata(hidden, source).fields.location!.includes("Aupark"));
});
test("ambiguous daylight-saving wall times use UTC and missing metadata leaves manual entry", () => {
  const review = metadataReview({
    status: "loaded",
    source_url: source.url,
    fields: {
      title: "Clock change",
      timezone: "Europe/Bratislava",
      starts_at: "2027-10-31T01:30:00.000Z",
    },
  });
  assert.equal(review.value.zone, "UTC");
  assert.equal(review.value.starts, "2027-10-31T01:30");
  assert.equal(review.value.to, "2027-11-01T01:30");
  assert.equal(metadataReview().value.starts, "");
  assert.match(metadataReview().notice, /still enter/);
});
test("metadata fetch rejects private/reserved IPv4 answers including mixed DNS before connecting", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.2",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicIPv4(address), false, address);
  assert.equal(publicIPv4("1.1.1.1"), true);
  const dns = mock.method(Resolver.prototype, "resolve4", async () => ["1.1.1.1", "127.0.0.1"]);
  try {
    await assert.rejects(
      downloadMetadataPage(new URL(source.url), AbortSignal.timeout(1000)),
      /Unsafe/,
    );
  } finally {
    dns.mock.restore();
  }
});
test("redirects must retain the provider and event key; loops, oversized and unavailable pages fall back", async () => {
  for (const target of [
    "http://luma.com/blxy7j09",
    "https://127.0.0.1/private",
    "https://luma.com/blxy7j09?token=secret",
    "https://luma.com/other",
    "https://evil.example/blxy7j09",
  ]) {
    let calls = 0;
    const result = await loadEventMetadata(source, async () => {
      calls++;
      return { status: 302, location: target };
    });
    assert.equal(result.status, "unavailable");
    assert.equal(calls, 1);
  }
  let calls = 0;
  await loadEventMetadata(source, async () => {
    calls++;
    return { status: 302, location: source.url };
  });
  assert.equal(calls, 3);
  assert.equal(
    (
      await loadEventMetadata(source, async () => ({
        status: 200,
        html: "x".repeat(2 * 1024 * 1024 + 1),
      }))
    ).status,
    "unavailable",
  );
  assert.equal(
    (
      await loadEventMetadata(source, async () => {
        throw new Error("Provider timeout");
      })
    ).status,
    "unavailable",
  );
  assert.equal(
    (await loadEventMetadata(source, async () => ({ status: 200, html: eventPage() }))).status,
    "loaded",
  );
});

test("HTTPS transport pins public DNS, preserves TLS hostname and bounds streamed responses", async () => {
  const dns = mock.method(Resolver.prototype, "resolve4", async () => ["1.1.1.1"]);
  try {
    for (const kind of ["ok", "large", "encoding", "type"]) {
      const transport = mock.method(https, "request", ((
        url: URL,
        options: Record<string, unknown>,
        callback: (response: IncomingMessage) => void,
      ) => {
        assert.equal(url.hostname, "luma.com");
        assert.equal(options.servername, "luma.com");
        assert.equal(options.agent, false);
        assert.equal(options.family, 4);
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal((options.headers as Record<string, string>).Cookie, undefined);
        const lookup = options.lookup as (
          host: string,
          options: unknown,
          callback: (error: unknown, address: string, family: number) => void,
        ) => void;
        lookup("luma.com", {}, (error, address, family) => {
          assert.equal(error, null);
          assert.equal(address, "1.1.1.1");
          assert.equal(family, 4);
        });
        const req = new EventEmitter() as EventEmitter & { end(): void };
        req.end = () =>
          queueMicrotask(() => {
            const response = new PassThrough() as unknown as IncomingMessage;
            response.statusCode = 200;
            response.headers = {
              "content-type": kind === "type" ? "image/png" : "text/html",
              ...(kind === "encoding" ? { "content-encoding": "gzip" } : {}),
            };
            callback(response);
            (response as unknown as PassThrough).end(
              kind === "large" ? Buffer.alloc(2 * 1024 * 1024 + 1) : eventPage(),
            );
          });
        return req;
      }) as typeof https.request);
      try {
        const promise = downloadMetadataPage(new URL(source.url), AbortSignal.timeout(1000));
        if (kind === "ok") assert.match((await promise).html!, /__NEXT_DATA__/);
        else await assert.rejects(promise);
      } finally {
        transport.mock.restore();
      }
    }
    assert.equal(dns.mock.callCount(), 4, "One DNS lookup per pinned connection");
  } finally {
    dns.mock.restore();
  }
});
