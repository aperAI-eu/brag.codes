import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, draft } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { deletionOperations } from "../src/lib/deletion/operations.ts";
import { galleryProjects, galleryEvents } from "../src/lib/gallery/reads.ts";
import { galleryParameters, literalPattern } from "../src/lib/gallery/parameters.ts";

const denied = (status: number) => (e: { status?: number }) => e.status === status;
test("public gallery operations, machine guidance and real anonymous browsers", async (t) => {
  const f = await ownedFixture(),
    migration = migrateCandidate(f);
  assert.equal(migration.status, 0, migration.output);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const db = createDatabase(f.runtimeUrl),
    browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await db.$disconnect();
    await admin.end();
  });
  const config = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
  };
  const owners: Awaited<ReturnType<typeof identity>>[] = [];
  for (let i = 0; i < 4; i++) owners.push(await identity(admin, config.authSecret));
  const first = await event(admin),
    second = await event(admin),
    privateEvent = await event(admin);
  await admin.query(
    "UPDATE brag.event SET title=CASE WHEN id=$1 THEN 'Public demo night' ELSE 'Public maker meetup' END WHERE id=ANY($2)",
    [first.id, [first.id, second.id]],
  );
  const auth = createAuth(db, config),
    pub = publicationOperations(auth, db, config.origin),
    deletion = deletionOperations(auth, db);
  const records: { id: string; owner: (typeof owners)[number] }[] = [];
  async function publish(title: string, eventId = first.id) {
    const owner = owners[records.length % owners.length],
      id = await draft(admin, owner.owner, eventId, "confirmed");
    await admin.query("UPDATE brag.project_draft SET fields=fields||$2::jsonb WHERE id=$1", [
      id,
      JSON.stringify({
        title,
        problem: "A public offline workshop problem",
        description: "Published description only. 100%_literal",
        repository_url: "https://example.test/private-repository-secret",
      }),
    ]);
    const review = await pub.prepare(owner.headers, id, randomUUID(), {
      expected_version: 2,
      public_author: {
        display_name: "Public builder",
        contact: { kind: "profile", value: "https://example.test/public-author" },
      },
      include: { project_link: false, repository_link: false, details: false },
    });
    await pub.publish(owner.headers, id, randomUUID(), { review_id: review.review_id });
    records.push({ id, owner });
    return id;
  }
  for (let i = 0; i < 22; i++)
    await publish(`Gallery project ${String(i).padStart(2, "0")}`, i % 2 ? first.id : second.id);
  await draft(admin, owners[0].owner, privateEvent.id, "confirmed");
  await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [second.id]);
  const api = (path: string) => fetch(f.baseUrl + path, { headers: { Connection: "close" } });
  await t.test(
    "anonymous lists and literal search exclude drafts, contact, source and membership",
    async () => {
      const r = await api("/api/v1/projects?limit=50");
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control") ?? "", /no-store/);
      const all = await r.json();
      assert.equal(all.projects.length, 22);
      assert.equal(all.next_cursor, null);
      for (const forbidden of [
        "secret-description",
        "private-repository-secret",
        owners[0].owner,
        "public-author",
        "session_token",
      ])
        assert.equal(JSON.stringify(all).includes(forbidden), false);
      assert.equal(
        (
          await galleryProjects(
            db,
            new URLSearchParams({ q: "private-repository-secret" }),
            f.baseUrl,
          )
        ).projects.length,
        0,
      );
      assert.equal(
        (await galleryProjects(db, new URLSearchParams({ q: "secret-description" }), f.baseUrl))
          .projects.length,
        0,
      );
      assert.equal(
        (
          await galleryProjects(
            db,
            new URLSearchParams({ q: "100%_literal", limit: "50" }),
            f.baseUrl,
          )
        ).projects.length,
        22,
      );
      assert.equal(
        (await galleryProjects(db, new URLSearchParams({ q: "100ZZliteral" }), f.baseUrl)).projects
          .length,
        0,
      );
      const scoped = await galleryProjects(
        db,
        new URLSearchParams({ q: "OFFLINE", event_id: second.id, limit: "50" }),
        f.baseUrl,
      );
      assert.equal(scoped.projects.length, 11);
      assert.deepEqual(scoped.projects[0].matched_fields, ["problem"]);
      const choices = await galleryEvents(db, new URLSearchParams({ limit: "1" }));
      assert.equal(choices.events.length, 1);
      assert.ok(choices.next_cursor);
      const next = await galleryEvents(
        db,
        new URLSearchParams({ limit: "1", cursor: choices.next_cursor }),
      );
      assert.equal(next.next_cursor, null);
      assert.notEqual(next.events[0].id, choices.events[0].id);
      assert.ok(![...choices.events, ...next.events].some((e) => e.id === privateEvent.id));
    },
  );
  await t.test("cursor scope, bounded inputs and SQL metacharacters fail safely", async () => {
    const firstPage = await galleryProjects(db, new URLSearchParams({ limit: "1" }), f.baseUrl);
    assert.ok(firstPage.next_cursor);
    await assert.rejects(
      () =>
        galleryProjects(
          db,
          new URLSearchParams({ q: "changed", cursor: firstPage.next_cursor! }),
          f.baseUrl,
        ),
      denied(400),
    );
    await assert.rejects(
      () => galleryEvents(db, new URLSearchParams({ cursor: firstPage.next_cursor! })),
      denied(400),
    );
    for (const query of [
      "limit=0",
      "limit=51",
      "event_id=nope",
      "q=a&q=b",
      "unknown=x",
      "cursor=garbage",
      "q=" + "x".repeat(2001),
      "q=%00",
    ]) {
      assert.equal((await api("/api/v1/projects?" + query)).status, 400, query.slice(0, 30));
    }
    assert.equal(
      (await galleryProjects(db, new URLSearchParams({ q: "' OR true --" }), f.baseUrl)).projects
        .length,
      0,
    );
    assert.equal(literalPattern("%_\\"), "%\\%\\_\\\\%");
    assert.equal(galleryParameters(new URLSearchParams({ q: "😀".repeat(2000) })).q.length, 4000);
  });
  await t.test(
    "pagination rechecks deletion and hidden state without admitting new publications",
    async () => {
      const page = await galleryProjects(db, new URLSearchParams({ limit: "2" }), f.baseUrl);
      assert.ok(page.next_cursor);
      const later = await galleryProjects(
        db,
        new URLSearchParams({ limit: "2", cursor: page.next_cursor }),
        f.baseUrl,
      );
      const remove = records.find((r) => r.id === later.projects[0].id)!;
      await deletion.remove(remove.owner.headers, remove.id, randomUUID(), {
        expected_version: 2,
        expected_published: true,
      });
      const hidden = later.projects[1].id;
      await admin.query(
        "UPDATE brag.project_public_state SET visibility='hidden' WHERE project_id=$1",
        [hidden],
      );
      const newest = await publish("New after snapshot");
      const ids = page.projects.map((p) => p.id);
      let cursor: string | null = page.next_cursor;
      while (cursor) {
        const next = await galleryProjects(
          db,
          new URLSearchParams({ limit: "2", cursor }),
          f.baseUrl,
        );
        ids.push(...next.projects.map((p) => p.id));
        cursor = next.next_cursor;
      }
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(!ids.includes(remove.id) && !ids.includes(hidden) && !ids.includes(newest));
      assert.equal((await api(`/api/v1/projects/${remove.id}`)).status, 404);
      assert.equal((await api(`/api/v1/projects/${hidden}`)).status, 404);
      assert.ok(
        (await galleryProjects(db, new URLSearchParams(), f.baseUrl)).projects.some(
          (p) => p.id === newest,
        ),
      );
    },
  );
  await t.test(
    "agent entry and guide describe actual JSON, preserve submission and expose no write capability",
    async () => {
      const guide = await api("/skills/discovery/v1.md");
      assert.equal(guide.status, 200);
      const text = await guide.text();
      assert.equal(
        guide.headers.get("x-content-sha256"),
        createHash("sha256").update(text).digest("hex"),
      );
      assert.ok(text.includes(f.baseUrl + "/api/v1/projects?limit=20"));
      assert.ok(text.includes("untrusted"));
      assert.ok(text.includes("Retry-After"));
      const llms = await api("/llms.txt");
      assert.equal(llms.status, 200);
      assert.ok((await llms.text()).includes(f.baseUrl + "/skills/discovery/v1.md"));
      assert.equal((await api("/skill.md")).status, 200);
      const id = records[0].id;
      const response = await fetch(`${f.baseUrl}/api/v1/projects/${id}`, {
        method: "DELETE",
        headers: {
          Origin: f.baseUrl,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ expected_version: 2, expected_published: true }),
      });
      assert.equal(response.status, 401);
    },
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ])
    await t.test(
      `${viewport.width}px gallery search, detail/back and agents work without a session`,
      async () => {
        const context = await browser.newContext({ viewport }),
          page = await context.newPage();
        try {
          const response = await page.goto(f.baseUrl + "/slop");
          assert.equal(response?.status(), 200);
          const main = page.getByRole("main");
          await expect(
            main.getByRole("heading", { name: "Slop Gallery", exact: true }),
          ).toBeVisible();
          await expect(main.locator(".gallery-card")).toHaveCount(20);
          await main.getByRole("button", { name: "Load more", exact: true }).click();
          await expect(main.locator(".gallery-card")).toHaveCount(21);
          await page.getByLabel("Search projects", { exact: true }).fill("Gallery project 01");
          await main.getByRole("button", { name: "Search", exact: true }).click();
          await expect(main.locator(".gallery-card")).toHaveCount(1);
          await main.getByRole("button", { name: "Gallery project 01", exact: true }).click();
          await expect(
            main.getByRole("heading", { name: "Gallery project 01", exact: true }),
          ).toBeVisible();
          await main.getByRole("button", { name: "View public JSON", exact: true }).click();
          const json = JSON.parse(await main.getByLabel("Public JSON response").innerText());
          assert.equal(json.project.content.author.href, "https://example.test/public-author");
          await main.getByRole("button", { name: "Back", exact: true }).click();
          await main.getByRole("button", { name: "Back to gallery", exact: true }).click();
          await expect(page.getByLabel("Search projects", { exact: true })).toHaveValue(
            "Gallery project 01",
          );
          await main.getByRole("button", { name: "For agents", exact: true }).click();
          await expect(
            main.getByRole("heading", { name: "Let your agent explore." }),
          ).toBeVisible();
          await expect(page.getByLabel("Discovery instructions · v1")).toHaveValue(
            new RegExp(f.baseUrl.replaceAll(".", "\\.")),
          );
          await main.getByRole("button", { name: "View example JSON", exact: true }).click();
          const list = JSON.parse(await main.getByLabel("Public JSON response").innerText());
          assert.equal(list.projects.length, 2);
          await page.goto(f.baseUrl + "/projects/" + randomUUID() + "?from=slop&q=offline");
          await expect(page.getByRole("heading", { name: "Project unavailable." })).toBeVisible();
          await page.getByRole("button", { name: "Back to gallery", exact: true }).click();
          await expect(page.getByLabel("Search projects", { exact: true })).toHaveValue("offline");
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
        } finally {
          await context.close();
        }
      },
    );
  await t.test("throttle and database failures are errors rather than empty success", async () => {
    await admin.query(
      "INSERT INTO brag.auth_throttle(key,\"window\",count) VALUES ('publication-public-read',date_trunc('minute',now()),600) ON CONFLICT(key) DO UPDATE SET count=600,\"window\"=date_trunc('minute',now())",
    );
    const r = await api("/api/v1/projects");
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
    await admin.query("DELETE FROM brag.auth_throttle WHERE key='publication-public-read'");
    await admin.query("REVOKE SELECT ON brag.project_public_state FROM brag_runtime");
    try {
      assert.equal((await api("/api/v1/projects")).status, 503);
    } finally {
      await admin.query("GRANT SELECT ON brag.project_public_state TO brag_runtime");
    }
    const explain = await admin.query(
      "EXPLAIN (ANALYZE,FORMAT JSON) SELECT p.project_id FROM brag.project_public_state s JOIN brag.project_publication p ON p.id=s.publication_id JOIN brag.event_appearance a ON a.project_id=s.project_id AND a.event_id=s.event_id WHERE s.visibility='published' AND p.projection->>'description' ILIKE '%offline%' ORDER BY p.published_at DESC,p.project_id DESC LIMIT 21",
    );
    await mkdir(".localfiles/runtime-evidence", { recursive: true });
    await writeFile(
      `.localfiles/runtime-evidence/${f.container}-gallery-query-plan.json`,
      JSON.stringify({ fixture_publications: 22, plan: explain.rows }, null, 2),
    );
  });
});
