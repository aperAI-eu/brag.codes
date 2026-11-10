import { scannerChecks } from "./scanner.integration.ts";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { chromium, expect } from "@playwright/test";
import type { BragAuth } from "../src/lib/auth/config.ts";
import type { createDatabase } from "../src/lib/database/client.ts";
import { eventOperations, resolveEvent } from "../src/lib/events/operations.ts";
import { AccessError } from "../src/lib/auth/access.ts";
import { EventError } from "../src/lib/events/validation.ts";
import type { ManagedEvent } from "../src/events/model.ts";
import type { RuntimeConfig } from "../src/lib/config/runtime.ts";
import { eventHandler } from "../src/lib/events/handler.ts";
import { loadEventMetadata, type MetadataLoader } from "../src/lib/events/metadata-fetch.ts";
import { eventPage } from "./event-metadata-fixture.ts";
export async function eventChecks(
  t: TestContext,
  fixture: { baseUrl: string; container: string },
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  runtime: pg.Client,
  admin: pg.Client,
  cookie: string,
  ordinaryCookie: string,
  config: RuntimeConfig,
) {
  let metadataCalls = 0;
  // Provider transport is mocked in this test process, with no test switch in the app.
  const metadata: MetadataLoader = (source) => {
    metadataCalls++;
    return loadEventMetadata(source, async () => ({
      status: source.url.endsWith("metadata-unavailable") ? 503 : 200,
      html: eventPage(source.url),
    }));
  };
  const origin = fixture.baseUrl,
    ops = eventOperations(auth, db, origin, metadata),
    previewHandler = eventHandler(auth, db, config, metadata),
    headers = new Headers({ Cookie: cookie });
  const body = {
    url: "https://luma.com/integration-night",
    reason: "Synthetic event integration",
    event: {
      title: "Integration night",
      timezone: "Europe/Bratislava",
      starts_at: "2030-01-01T17:00:00Z",
      submissions_open_at: "2030-01-01T16:00:00Z",
      submissions_close_at: "2030-01-02T17:00:00Z",
    },
  };
  const call = async (
    path: string,
    method = "GET",
    input?: unknown,
    key = randomUUID(),
    session = cookie,
    from = origin,
  ) => {
    const options = {
      method,
      headers: {
        Cookie: session,
        Origin: from,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    };
    const url = origin + "/api/v1/" + path;
    return path === "admin/event-candidates/preview"
      ? previewHandler(new Request(url, options))
      : fetch(url, options);
  };
  let saved: ManagedEvent;
  await t.test(
    "events enforce authority inside operations and origin, fields and body limits at HTTP",
    async () => {
      for (const session of ["", ordinaryCookie]) {
        const expected = session ? 403 : 401;
        assert.equal(
          (await call("admin/events", "GET", undefined, randomUUID(), session)).status,
          expected,
        );
        await assert.rejects(
          ops.mutate(new Headers({ Cookie: session }), "whitelist", null, randomUUID(), body),
          (e: AccessError) => e.status === expected,
        );
        await assert.rejects(
          ops.preview(new Headers({ Cookie: session }), { url: body.url }),
          (e: AccessError) => e.status === expected,
        );
      }
      assert.equal(
        (
          await call(
            "admin/events/whitelist",
            "POST",
            body,
            randomUUID(),
            cookie,
            "https://evil.test",
          )
        ).status,
        403,
      );
      assert.equal(
        (await call("admin/events/whitelist", "POST", { ...body, role: "platform_admin" })).status,
        400,
      );
      assert.equal(
        (await call("admin/event-candidates/preview", "POST", { url: "x".repeat(5000) })).status,
        400,
      );
      assert.equal(
        (await call("admin/events/whitelist", "POST", { ...body, reason: "x".repeat(33000) }))
          .status,
        400,
      );
      assert.equal(
        (
          await call("admin/events/whitelist", "POST", {
            ...body,
            event: { ...body.event, submissions_close_at: body.event.submissions_open_at },
          })
        ).status,
        422,
      );
      assert.equal((await call("admin/events?limit=51")).status, 400);
      assert.equal(await db.event.count(), 0);
      assert.equal(metadataCalls, 0, "Denied/invalid previews must not contact a provider");
      assert.equal(
        (
          await fetch(origin + "/api/v1/admin/event-candidates/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ url: body.url }),
          })
        ).status,
        401,
      );
    },
  );
  await t.test(
    "atomic whitelist, equivalent aliases, exact retry and concurrent duplicates produce one record and audit",
    async () => {
      assert.equal(
        (await call("events/resolve", "POST", { url: body.url }, randomUUID(), "")).status,
        404,
      );
      const preview = await (
        await call("admin/event-candidates/preview", "POST", { url: body.url })
      ).json();
      const unavailable = await (
        await call(
          "events/resolve",
          "POST",
          { url: "https://luma.com/never-approved" },
          randomUUID(),
          "",
        )
      ).json();
      assert.equal(unavailable.error.code, "event_unavailable");
      assert.ok(unavailable.error.message);
      assert.match(unavailable.error.request_id, /^[a-f0-9-]{36}$/);
      assert.equal(preview.state, "new");
      assert.equal(preview.metadata.status, "loaded");
      assert.equal(preview.metadata.fields.starts_at, "2026-11-09T17:00:00.000Z");
      assert.equal(await db.event.count(), 0);
      const key = randomUUID();
      const results = await Promise.all([
        call("admin/events/whitelist", "POST", body, key),
        call("admin/events/whitelist", "POST", body, key),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201],
      );
      const first = await results[0].json();
      assert.deepEqual(await results[1].json(), first);
      saved = first.event;
      const callsBefore = metadataCalls;
      const known = await ops.preview(headers, { url: body.url });
      assert.equal(known.event?.title, body.event.title);
      assert.equal(metadataCalls, callsBefore, "Saved events must not be refetched or overwritten");
      assert.equal(
        (await call("admin/events/whitelist", "POST", { ...body, reason: "Different intent" }, key))
          .status,
        409,
      );
      const concurrent = await Promise.all([
        call("admin/events/whitelist", "POST", {
          ...body,
          url: "https://lu.ma/integration-night/",
        }),
        call("admin/events/whitelist", "POST", body),
      ]);
      assert.ok(concurrent.every((r) => r.status === 409));
      assert.equal(await db.event.count(), 1);
      assert.equal(await db.eventAudit.count(), 1);
      assert.equal(await db.eventMutation.count(), 1);
      const result = await (
        await call("events/resolve", "POST", { url: body.url }, randomUUID(), "")
      ).json();
      const noOrigin = await fetch(origin + "/api/v1/events/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: body.url }),
      });
      assert.equal(noOrigin.status, 200);
      assert.equal(result.event.id, saved.id);
      assert.equal(result.event.submission_state, "scheduled");
      for (const forbidden of ["audit", "actor_id", "aliases", "email", "version"])
        assert.ok(!(forbidden in result.event));
      assert.equal(result.event.canonical_url, `${origin}/events/${saved.id}`);
      assert.equal((await fetch(result.event.canonical_url)).status, 200);
    },
  );
  await t.test(
    "optimistic versions prevent overwritten edits; saved bounds survive rescheduling and filters paginate",
    async () => {
      const edit = {
        expected_version: saved.version,
        event: { title: "Edited integration night", starts_at: "2030-02-01T17:00:00Z" },
        reason: "Reschedule only",
      };
      const results = await Promise.all([
        call(`events/${saved.id}`, "PATCH", edit),
        call(`events/${saved.id}`, "PATCH", edit),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      saved = (await results.find((r) => r.status === 200)!.json()).event;
      assert.equal(saved.submissions_open_at, "2030-01-01T16:00:00.000Z");
      const list = await (
        await call("admin/events?query=Edited&submission=scheduled&approval=approved&limit=1")
      ).json();
      assert.equal(list.events.length, 1);
      assert.equal(list.events[0].id, saved.id);
      const next = await (await call("admin/events?cursor=" + saved.id)).json();
      assert.equal(next.events.length, 0);
      assert.equal((await call("admin/events?submission=invalid")).status, 400);
    },
  );
  await t.test(
    "manual closure, suspension and alias lifecycle have separate effects and auditable versions",
    async () => {
      const change = async (action: string, extra = {}, method = "POST") => {
        const result = await call(`events/${saved.id}/${action}`, method, {
          expected_version: saved.version,
          reason: "Lifecycle integration",
          ...extra,
        });
        assert.equal(result.status, 200);
        saved = (await result.json()).event;
      };
      await change("close");
      assert.equal(saved.submission_state, "closed");
      const edited = await call(`events/${saved.id}`, "PATCH", {
        expected_version: saved.version,
        reason: "Extend window",
        event: { submissions_close_at: "2031-01-01T17:00:00Z" },
      });
      saved = (await edited.json()).event;
      assert.equal(saved.manually_closed, true);
      await change("reopen");
      assert.equal(saved.submission_state, "scheduled");
      await change("suspend");
      await assert.rejects(
        resolveEvent(db, origin, { url: body.url }),
        (e: EventError) => e.status === 404,
      );
      assert.equal((await fetch(`${origin}/events/${saved.id}`)).status, 404);
      await change("approve");
      const alias = saved.aliases[0];
      await change(
        `source-aliases/${alias.id}`,
        { expected_alias_version: alias.version },
        "DELETE",
      );
      await assert.rejects(
        resolveEvent(db, origin, { url: body.url }),
        (e: EventError) => e.status === 404,
      );
      assert.equal((await call("admin/events/whitelist", "POST", body)).status, 409);
      assert.equal((await fetch(`${origin}/events/${saved.id}`)).status, 200);
      await change(`source-aliases/${alias.id}/approve`, {
        expected_alias_version: saved.aliases[0].version,
      });
      await change("source-aliases", { url: "https://www.meetup.com/builders/events/123456/" });
      await assert.rejects(
        resolveEvent(db, origin, { url: "https://www.meetup.com/builders/events/123456/" }),
        (e: EventError) => e.status === 404,
      );
      const proposed = saved.aliases.find((a) => a.state === "pending")!;
      await change(`source-aliases/${proposed.id}/approve`, {
        expected_alias_version: proposed.version,
      });
      assert.equal((await resolveEvent(db, origin, { url: proposed.url })).event.id, saved.id);
      await change(
        `source-aliases/${alias.id}`,
        { expected_alias_version: saved.aliases.find((a) => a.id === alias.id)!.version },
        "DELETE",
      );
      assert.equal(await db.eventAudit.count(), saved.version);
      for (const sql of [
        "UPDATE brag.event_audit SET reason = 'tamper'",
        "DELETE FROM brag.event_mutation",
        "DELETE FROM brag.event",
        "UPDATE brag.event_source_alias SET event_id = gen_random_uuid()",
      ])
        await assert.rejects(runtime.query(sql), (e: { code: string }) => e.code === "42501");
      await assert.rejects(
        admin.query(
          "UPDATE brag.event SET submissions_open_at = submissions_close_at WHERE id = $1",
          [saved.id],
        ),
        (e: { code: string }) => e.code === "23514",
      );
    },
  );
  await t.test(
    "preview rechecks authority after provider lookup and commits no event",
    async () => {
      const user = (await auth.api.getSession({ headers }))!.user.id;
      const before = await db.event.count();
      const revoking = eventOperations(auth, db, origin, async (source) => {
        await admin.query('UPDATE brag.platform_role SET active = false WHERE "userId" = $1', [
          user,
        ]);
        return metadata(source);
      });
      try {
        await assert.rejects(
          revoking.preview(headers, { url: "https://luma.com/revoked-preview" }),
          (e: AccessError) => e.status === 403,
        );
        assert.equal(await db.event.count(), before);
      } finally {
        await admin.query('UPDATE brag.platform_role SET active = true WHERE "userId" = $1', [
          user,
        ]);
      }
    },
  );
  await t.test(
    "mobile create, lost-response recovery and desktop edit persist across browser contexts",
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pair = cookie.split("; ").find((v) => v.startsWith("brag.session_token="))!;
      const newContext = async (width: number) => {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addCookies([
          {
            name: "brag.session_token",
            value: pair.slice(pair.indexOf("=") + 1),
            url: origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        // Exercise the real handler/operation and database, substituting only provider I/O.
        await context.route("**/api/v1/admin/event-candidates/preview", async (route) => {
          const req = route.request();
          const result = await previewHandler(
            new Request(req.url(), {
              method: req.method(),
              headers: await req.allHeaders(),
              body: req.postData(),
            }),
          );
          await route.fulfill({
            status: result.status,
            headers: Object.fromEntries(result.headers),
            body: await result.text(),
          });
        });
        return context;
      };
      try {
        const mobile = await newContext(390),
          page = await mobile.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(origin + "/admin");
        await page.getByRole("button", { name: "Add event", exact: true }).click();
        await page
          .getByLabel("Or paste the event link", { exact: true })
          .fill("https://luma.com/browser-integration");
        await page.getByRole("button", { name: "Review event link" }).click();
        await expect(page.getByLabel("Event title")).toHaveValue(
          "DevDay Exchange Community Demo Night: Bratislava",
        );
        await expect(page.getByLabel("Event time zone")).toHaveValue("Europe/Prague");
        await expect(page.getByLabel("Event starts")).toHaveValue("2026-11-09T18:00");
        await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-11-09T17:00");
        await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-11-10T18:00");
        await expect(page.getByLabel("Location (optional)")).toHaveValue(
          "ESET, Aupark Tower, Bratislava, Slovakia",
        );
        await page.screenshot({
          path: `.localfiles/runtime-evidence/${fixture.container}-event-import-390.png`,
          fullPage: true,
        });
        await page.getByLabel("Event title").fill("Phone-created event");
        await page.getByLabel("Event starts").fill("2030-06-01T18:00");
        await expect(page.getByLabel("From", { exact: true })).toHaveValue("2030-06-01T17:00");
        await expect(page.getByLabel("To", { exact: true })).toHaveValue("2030-06-02T18:00");
        await page.getByLabel("From", { exact: true }).fill("2030-06-01T15:00");
        await page.getByLabel("Event starts").fill("2030-06-01T19:00");
        await expect(page.getByLabel("From", { exact: true })).toHaveValue("2030-06-01T15:00");
        await expect(page.getByLabel("To", { exact: true })).toHaveValue("2030-06-02T19:00");
        await page.screenshot({
          path: `.localfiles/runtime-evidence/${fixture.container}-event-review-390.png`,
          fullPage: true,
        });
        await page.route(
          "**/api/v1/admin/events/whitelist",
          async (route) => {
            await route.fetch();
            await route.abort("failed");
          },
          { times: 1 },
        );
        await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Save not confirmed" })).toBeVisible();
        await page.getByRole("button", { name: "Retry same save" }).click();
        await expect(
          page.getByRole("heading", { name: "Phone-created event", exact: true }),
        ).toBeVisible();
        assert.equal(await db.event.count({ where: { title: "Phone-created event" } }), 1);
        const desktop = await newContext(1280),
          other = await desktop.newPage();
        await other.goto(origin + "/admin");
        await other.getByRole("button", { name: "Manage Phone-created event" }).click();
        await other.getByRole("button", { name: "Edit event", exact: true }).click();
        await other.getByLabel("Event title").fill("Edited on computer");
        await other.getByLabel("Event starts").fill("2030-06-02T20:00");
        await expect(other.getByLabel("To", { exact: true })).toHaveValue("2030-06-02T19:00");
        await other.getByLabel("Reason for change").fill("Cross-device review");
        await other.getByRole("button", { name: "Save changes", exact: true }).click();
        await expect(other.getByRole("heading", { name: "Edited on computer" })).toBeVisible();
        await page.getByRole("button", { name: "Refresh saved event" }).click();
        await expect(page.getByRole("heading", { name: "Edited on computer" })).toBeVisible();
        for (const [target, width] of [
          [page, 390],
          [other, 1280],
        ] as const) {
          assert.ok(
            await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          );
          await target.screenshot({
            path: `.localfiles/runtime-evidence/${fixture.container}-event-detail-${width}.png`,
            fullPage: true,
          });
        }
        assert.deepEqual(errors, []);
        await other.getByRole("button", { name: "Back to events", exact: true }).click();
        await other.getByRole("button", { name: "Add event", exact: true }).click();
        await other
          .getByLabel("Or paste the event link", { exact: true })
          .fill("https://luma.com/metadata-unavailable");
        await other.getByRole("button", { name: "Review event link" }).click();
        await expect(other.getByRole("status")).toContainText("You can still enter");
        await expect(other.getByLabel("Event title")).toHaveValue("");
        await other.getByLabel("Event starts").fill("2030-01-01T18:00");
        await expect(other.getByLabel("From", { exact: true })).toHaveValue("2030-01-01T17:00");
        await mobile.close();
        await desktop.close();
      } finally {
        await browser.close();
      }
    },
  );
  const scanEvent = await ops.mutate(headers, "whitelist", null, randomUUID(), {
    ...body,
    url: "https://luma.com/scanner-integration",
    event: {
      ...body.event,
      title: "Scanner integration night",
      starts_at: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
      submissions_open_at: new Date(Math.floor(Date.now() / 60000) * 60000 - 3600000).toISOString(),
      submissions_close_at: new Date(
        Math.floor(Date.now() / 60000) * 60000 + 86400000,
      ).toISOString(),
    },
  });
  await scannerChecks(
    t,
    origin,
    ordinaryCookie,
    (scanEvent.body as { event: ManagedEvent }).event.id,
    "https://luma.com/scanner-integration",
  );
}
