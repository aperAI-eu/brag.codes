import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, association } from "./fixtures/sharing-history.ts";
import { emptyProject } from "../src/projects/model.ts";

test("real publication controller through HTTP, private history and public pages", async (t) => {
  const f = await ownedFixture(),
    migration = migrateCandidate(f);
  assert.equal(migration.status, 0, migration.output);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await admin.end();
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ])
    await t.test(
      `${viewport.width}px: edit, review, lost publish response, reload receipt and public snapshot`,
      async () => {
        const author = await identity(admin, await readFile(f.authFile, "utf8")),
          e = await event(admin);
        await association(admin, author.owner, e.id);
        async function api(path: string, method = "GET", body?: unknown) {
          const r = await fetch(f.baseUrl + path, {
            method,
            headers: {
              Cookie: author.cookie,
              Origin: f.baseUrl,
              "Content-Type": "application/json",
              "X-Capture-Contract": "share-work-v1",
              "Idempotency-Key": randomUUID(),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          assert.ok(r.ok, `${method} ${path}: ${r.status}`);
          return r.json();
        }
        const { draft } = await api("/api/v1/drafts", "POST", { event_id: e.id });
        await api("/api/v1/drafts/" + draft.id, "PATCH", {
          expected_version: 1,
          fields: {
            ...emptyProject,
            title: "Public browser fixture",
            problem: "Offline notes",
            description: "Description in original language",
            repository_url: "https://example.test/private-repository",
          },
          review_source: { method: "typed" },
        });
        const context = await browser.newContext({ viewport });
        await context.addCookies([
          {
            name: "brag.session_token",
            value: author.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        const page = await context.newPage();
        try {
          await page.goto(f.baseUrl + "/my/projects");
          await expect(
            page.getByRole("heading", { name: "Public browser fixture", exact: true }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Public browser fixture", exact: true }).click();
          await page.getByRole("button", { name: "Continue to publication", exact: true }).click();
          await page
            .getByLabel("What did you build?", { exact: true })
            .fill("Edited before public preview.");
          await page.getByRole("button", { name: "Continue to publication", exact: true }).click();
          await page.getByLabel("Public display name").fill("Demo maker");
          await page
            .getByLabel("Public profile link", { exact: true })
            .fill("https://example.test/maker");
          await page.getByRole("button", { name: "Review public page", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "Here’s what people will see." }),
          ).toBeVisible();
          await expect(
            page.getByText("Edited before public preview.", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText("https://example.test/private-repository", { exact: true }),
          ).toHaveCount(0);
          const publicBefore = await fetch(f.baseUrl + "/api/v1/projects/" + draft.id);
          assert.equal(publicBefore.status, 404);
          await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [e.id]);
          await page
            .getByLabel("I have reviewed this project and the public contact details.")
            .check();
          // Commit on the real server, deliberately lose only the client-facing response.
          await page.route("**/api/v1/projects/*/publish", async (route) => {
            const r = await route.fetch();
            assert.equal(r.status(), 201);
            await route.abort("failed");
          });
          await page.getByRole("button", { name: "Publish project", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "Publication not yet confirmed." }),
          ).toBeVisible();
          await page.unroute("**/api/v1/projects/*/publish");
          await page.reload();
          await expect(
            page.getByRole("heading", { name: "Publication not yet confirmed." }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Check publication", exact: true }).click();
          await expect(page.getByText("PROJECT PUBLISHED", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "View public project", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "Public browser fixture", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("link", { name: /https:\/\/example.test\/maker/ }),
          ).toBeVisible();
          const publicResponse = await fetch(f.baseUrl + "/api/v1/projects/" + draft.id);
          assert.equal(publicResponse.status, 200);
          const result = await publicResponse.json();
          assert.equal(result.project.content.description, "Edited before public preview.");
          assert.deepEqual(result.project.content.links, []);
          assert.match(publicResponse.headers.get("cache-control") ?? "", /no-store/);
          assert.equal(
            (
              await admin.query(
                "SELECT count(*)::int AS n FROM brag.project_publication WHERE project_id=$1",
                [draft.id],
              )
            ).rows[0].n,
            1,
          );
          const artifacts = ".localfiles/runtime-evidence";
          await mkdir(artifacts, { recursive: true });
          await page.screenshot({
            path: `${artifacts}/publication-${viewport.width}.png`,
            fullPage: true,
          });
          await page.getByRole("link", { name: "Event projects", exact: true }).click();
          await expect(
            page.getByRole("button", { name: "Public browser fixture", exact: true }),
          ).toBeVisible();
          await page.goto(f.baseUrl + "/my/projects");
          await expect(page.getByText(/Published project/)).toBeVisible();
          const anonymous = await browser.newContext({ viewport });
          try {
            const p = await anonymous.newPage();
            await p.goto(f.baseUrl + "/projects/" + draft.id);
            await expect(
              p.getByRole("heading", { name: "Public browser fixture", exact: true }),
            ).toBeVisible();
          } finally {
            await anonymous.close();
          }
        } finally {
          await context.close();
        }
      },
    );
});
