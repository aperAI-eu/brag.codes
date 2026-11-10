import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, association, draft, largeHistory } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { Prisma } from "../src/generated/prisma/client.ts";
import { context as contextQuery, projects as projectsQuery } from "../src/lib/sharing/queries.ts";
import { sharingOperations } from "../src/lib/sharing/operations.ts";
import { encodeCursor } from "../src/lib/sharing/validation.ts";
import { AccessError } from "../src/lib/auth/access.ts";
import { EventError, normalizeSource } from "../src/lib/events/validation.ts";
import { resolveEvent } from "../src/lib/events/operations.ts";
import { boundaryChecks } from "./sharing-boundaries.integration.ts";
import { lifecycleChecks } from "./sharing-lifecycle.integration.ts";

test("private sharing operations and real HTTP on an owned current-schema database", async (t) => {
  const fixture = await ownedFixture();
  assert.equal(migrateCandidate(fixture).status, 0);
  const admin = new pg.Client({ connectionString: fixture.adminUrl });
  await admin.connect();
  const db = createDatabase(fixture.runtimeUrl);
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
  });
  const config = {
    environment: "local" as const,
    origin: fixture.baseUrl,
    databaseUrl: fixture.runtimeUrl,
    authSecret: await readFile(fixture.authFile, "utf8"),
  };
  const auth = createAuth(db, config),
    ops = sharingOperations(auth, db, config.origin);
  const owner = await identity(admin, config.authSecret),
    other = await identity(admin, config.authSecret);
  const second = await identity(admin, config.authSecret, owner.owner);
  const live = await event(admin),
    closed = await event(admin, { state: "closed" }),
    scheduled = await event(admin, { state: "scheduled" }),
    suspended = await event(admin, { state: "suspended" });
  const link = (
    url: string,
    method = "pasted_url",
    key: string = randomUUID(),
    headers = owner.headers,
  ) => ops.link(headers, key, { url, entry_method: method });
  const call = (
    path: string,
    method = "GET",
    input?: unknown,
    cookie = owner.cookie,
    extra: Record<string, string> = {},
  ) =>
    fetch(config.origin + "/api/v1/me/" + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: config.origin,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        ...extra,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const status = (code: number) => (error: EventError | AccessError) => error.status === code;
  {
    await t.test(
      "operations derive the owner from actual sessions; GET and public resolve never link",
      async () => {
        assert.equal((await call("share-context", "GET", undefined, "")).status, 401);
        assert.equal(
          (await call("events", "GET", undefined, "", { Authorization: "Bearer fake-upload" }))
            .status,
          401,
        );
        for (const fn of [
          () => ops.context(new Headers()),
          () => ops.events(new Headers()),
          () => ops.projects(new Headers()),
          () => link(live.url, "pasted_url", randomUUID(), new Headers()),
        ])
          await assert.rejects(fn, status(401));
        assert.equal((await call("share-context?owner_id=" + other.owner)).status, 400);
        await assert.rejects(ops.projects(owner.headers, { owner_id: other.owner }), status(400));
        await assert.rejects(ops.projects(owner.headers, { state: null }), status(400));
        await assert.rejects(ops.events(owner.headers, { state: null }), status(400));
        assert.equal((await ops.context(owner.headers)).linked_event_count, 0);
        await resolveEvent(db, config.origin, { url: live.url });
        assert.equal(await db.authorEvent.count(), 0);
        assert.equal((await ops.context(second.headers)).project_count, 0);
      },
    );
    let firstKey: string;
    await t.test(
      "concurrent aliases create one durable association, accurate origin and exact receipts",
      async () => {
        firstKey = randomUUID();
        const [a, b] = await Promise.all([
          link(live.url, "pasted_url", firstKey),
          link(live.url.replace("luma.com", "lu.ma"), "qr_scan"),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 201]);
        assert.equal(await db.authorEvent.count({ where: { ownerId: owner.owner } }), 1);
        assert.deepEqual(
          (await link(live.url.replace("luma.com", "lu.ma"), "pasted_url", firstKey)).body,
          a.body,
        );
        await assert.rejects(link(live.url, "qr_scan", firstKey), status(409));
        await assert.rejects(link(live.url, "direct_event"), status(400));
      },
    );
    // Direct entry is a canonical route, not a provenance override on a provider URL.
    await t.test(
      "direct entries use the configured canonical origin; separate sessions see identical links",
      async () => {
        await assert.rejects(link(live.url, "direct_event"), status(400));
        const canonical = config.origin + "/events/" + live.id;
        assert.equal(normalizeSource(canonical, config.origin).eventId, live.id);
        assert.equal((await link(canonical, "direct_event")).status, 200);
        await assert.rejects(link("http://luma.com/" + live.slug), status(422));
        const a = await ops.events(owner.headers),
          b = await ops.events(second.headers);
        assert.deepEqual(a.events, b.events);
        assert.equal((await ops.context(owner.headers)).single_eligible_event?.id, live.id);
        assert.equal(await db.projectDraft.count(), 0);
        assert.equal((await ops.events(other.headers)).events.length, 0);
      },
    );
    await t.test(
      "closed/scheduled links survive; removed aliases and suspension deny new links but allow exact replay",
      async () => {
        await link(closed.url);
        await link(scheduled.url);
        await assert.rejects(link(suspended.url), status(404));
        const key = randomUUID();
        const receipt = await link(live.url, "pasted_url", key);
        await admin.query("UPDATE brag.event_source_alias SET state='removed' WHERE event_id=$1", [
          live.id,
        ]);
        await admin.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [live.id]);
        await assert.rejects(link(live.url), status(404));
        const replay = await link(live.url, "pasted_url", key);
        assert.equal(replay.status, receipt.status);
        assert.equal(replay.body.receipt, key);
        assert.equal(replay.body.event.submission_state, "suspended");
        assert.equal(replay.body.event.eligible, false);
        assert.equal((await ops.context(owner.headers)).eligible_event_count, 0);
        assert.equal((await ops.events(owner.headers)).events.length, 3);
        await admin.query("UPDATE brag.event SET approval='approved' WHERE id=$1", [live.id]);
        await admin.query("UPDATE brag.event_source_alias SET state='approved' WHERE event_id=$1", [
          live.id,
        ]);
        assert.equal((await ops.context(owner.headers)).eligible_event_count, 1);
      },
    );
    await t.test(
      "HTTP rejects forged fields, duplicate parameters, invalid cursors and unsafe mutations",
      async () => {
        for (const path of [
          "events?state=unknown",
          "events?state=all&state=eligible",
          "events?limit=100",
          "projects?sort=title",
          "projects?event_id=bad",
          "projects?cursor=broken",
          "share-context?query=anything",
        ])
          assert.equal((await call(path)).status, 400, path);
        const body = { url: live.url, entry_method: "pasted_url" };
        for (const change of [
          { origin: "https://other.test" },
          { "sec-fetch-site": "cross-site" },
        ] as Record<string, string>[])
          assert.equal((await call("events", "POST", body, owner.cookie, change)).status, 403);
        assert.equal(
          (await call("events", "POST", body, owner.cookie, { "Idempotency-Key": "bad" })).status,
          400,
        );
        assert.equal(
          (await call("events", "POST", body, owner.cookie, { "Content-Type": "text/plain" }))
            .status,
          400,
        );
        assert.equal(
          (await call("events", "POST", { ...body, owner_id: other.owner })).status,
          400,
        );
        assert.equal(
          (await call("events", "POST", { ...body, entry_method: "legacy_project" })).status,
          400,
        );
        assert.equal(
          (await call("events", "POST", { ...body, url: "x".repeat(5000) })).status,
          400,
        );
        assert.equal(
          (await call("events", "POST", { ...body, url: "https://private.test/event" })).status,
          422,
        );
        const result = await call("events", "POST", body);
        assert.equal(result.status, 200);
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        assert.equal(result.headers.get("referrer-policy"), "no-referrer");
        const value = await result.text();
        for (const secret of ["approved_by", "audit", "source_key", owner.owner])
          assert.ok(!value.includes(secret));
        assert.equal((await call("events", "DELETE")).status, 404);
      },
    );
    await lifecycleChecks(t, admin, ops, owner, closed.id, call);
    await t.test(
      "keyset pages retain microsecond order and bind cursors to owner, state, event and current membership",
      async () => {
        const paging = await identity(admin, config.authSecret);
        const ids: string[] = [];
        for (let i = 0; i < 53; i++) {
          const e = await event(admin);
          await association(admin, paging.owner, e.id);
          ids.push(e.id);
        }
        const page1 = await ops.events(paging.headers);
        assert.equal(page1.events.length, 50);
        assert.ok(page1.next_cursor);
        const page2 = await ops.events(paging.headers, { cursor: page1.next_cursor });
        assert.equal(page2.events.length, 3);
        assert.equal(page2.next_cursor, null);
        assert.equal(new Set([...page1.events, ...page2.events].map((e) => e.id)).size, 53);
        await assert.rejects(ops.events(other.headers, { cursor: page1.next_cursor }), status(400));
        await assert.rejects(
          ops.events(paging.headers, { state: "eligible", cursor: page1.next_cursor }),
          status(400),
        );
        const eligible = await ops.events(paging.headers, { state: "eligible" });
        await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [
          eligible.events[49].id,
        ]);
        await assert.rejects(
          ops.events(paging.headers, { state: "eligible", cursor: eligible.next_cursor }),
          status(400),
        );
        for (let i = 0; i < 53; i++) await draft(admin, paging.owner, ids[0]);
        const p1 = await ops.projects(paging.headers, { state: "all", event_id: ids[0] });
        const p2 = await ops.projects(paging.headers, {
          state: "all",
          event_id: ids[0],
          cursor: p1.next_cursor,
        });
        assert.equal(p1.projects.length, 50);
        assert.equal(p2.projects.length, 3);
        assert.equal(new Set([...p1.projects, ...p2.projects].map((p) => p.id)).size, 53);
        for (const filter of [
          { state: "all", event_id: ids[1] },
          { state: "unfinished", event_id: ids[0] },
          { state: "all" },
        ])
          await assert.rejects(
            ops.projects(paging.headers, { ...filter, cursor: p1.next_cursor }),
            status(400),
          );
        await assert.rejects(
          ops.projects(other.headers, { state: "all", event_id: ids[0], cursor: p1.next_cursor }),
          status(400),
        );
        const foreign = await draft(admin, other.owner, ids[0]);
        const forged = encodeCursor(
          paging.owner,
          { kind: "projects", state: "all", event_id: ids[0] },
          foreign,
        );
        await assert.rejects(
          ops.projects(paging.headers, { state: "all", event_id: ids[0], cursor: forged }),
          status(400),
        );
        // Exact ties must use the UUID tiebreaker, not whichever row PostgreSQL returns first.
        await admin.query(
          "UPDATE brag.project_draft SET created_at='2025-01-01T00:00:00Z' WHERE owner_id=$1",
          [paging.owner],
        );
        const tied = await ops.projects(paging.headers, { state: "all" });
        assert.deepEqual(
          tied.projects.map((p) => p.id),
          [...p1.projects, ...p2.projects]
            .map((p) => p.id)
            .sort()
            .reverse()
            .slice(0, 50),
        );
        await admin.query("UPDATE brag.project_draft SET discarded_at=now() WHERE id=$1", [
          p1.projects[49].id,
        ]);
        await assert.rejects(
          ops.projects(paging.headers, { state: "all", event_id: ids[0], cursor: p1.next_cursor }),
          status(400),
        );
      },
    );
    await t.test(
      "10k-project history stays bounded and context counts agree; multiple live events do not select the first",
      async () => {
        const bulk = await identity(admin, config.authSecret),
          e = await event(admin);
        await largeHistory(admin, bulk.owner, e.id);
        const summary = await ops.context(bulk.headers),
          page = await ops.projects(bulk.headers, { state: "unfinished" });
        assert.equal(summary.unfinished_count, 10000);
        assert.equal(summary.project_count, 0);
        assert.equal(page.projects.length, 50);
        assert.ok(page.next_cursor);
        const next = await ops.projects(bulk.headers, {
          state: "unfinished",
          cursor: page.next_cursor,
        });
        assert.equal(new Set([...page.projects, ...next.projects].map((p) => p.id)).size, 100);
        const plans: unknown[] = [];
        const measured = {
          $queryRaw: async (q: Prisma.Sql) => {
            plans.push(
              await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`),
            );
            return db.$queryRaw(q);
          },
        } as unknown as Prisma.TransactionClient;
        await contextQuery(measured, bulk.owner, config.origin);
        await projectsQuery(measured, bulk.owner, config.origin, { state: "unfinished" });
        await writeFile(
          `.localfiles/runtime-evidence/${fixture.container}-history-plans.json`,
          JSON.stringify({ cardinality: 10000, pageSize: 50, plans }, null, 2),
        );
        const otherEvent = await event(admin);
        await association(admin, bulk.owner, otherEvent.id);
        const multiple = await ops.context(bulk.headers);
        assert.equal(multiple.eligible_event_count, 2);
        assert.equal(multiple.single_eligible_event, null);
      },
    );
    await boundaryChecks(t, fixture, admin, db, auth, config);
    await t.test(
      "all sharing routes share one account budget and disabled/expired identities cannot read or link",
      async () => {
        await admin.query(
          `INSERT INTO brag.auth_throttle(key,"window",count) VALUES ($1,date_trunc('minute',now()),120) ON CONFLICT(key) DO UPDATE SET "window"=EXCLUDED."window",count=120`,
          ["sharing:" + owner.owner],
        );
        for (const path of ["events", "projects", "share-context"]) {
          const r = await call(path);
          assert.equal(r.status, 429);
          assert.equal(r.headers.get("retry-after"), "60");
        }
        assert.equal(
          (await call("events", "POST", { url: live.url, entry_method: "qr_scan" })).status,
          429,
        );
        await admin.query("UPDATE brag.auth_user SET active=false WHERE id=$1", [owner.owner]);
        assert.equal((await call("share-context")).status, 401);
        await assert.rejects(ops.context(second.headers), status(401));
        await assert.rejects(link(live.url), status(401));
        await admin.query("UPDATE brag.auth_user SET active=true WHERE id=$1", [owner.owner]);
        await admin.query(
          "UPDATE brag.auth_session SET \"expiresAt\"=now()-interval '1 second' WHERE id=$1",
          [owner.session],
        );
        await assert.rejects(ops.projects(owner.headers), status(401));
        assert.ok((await ops.context(second.headers)).linked_event_count > 0);
      },
    );
  }
});
