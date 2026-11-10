import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, association } from "./fixtures/sharing-history.ts";
import { emptyProject } from "../src/projects/model.ts";

test("real owner deletion UI, lost-response reload and public removal", async (t) => {
  const f = await ownedFixture();
  const migration = migrateCandidate(f);
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
    await t.test(`${viewport.width}px owner delete and receipt recovery`, async () => {
      const owner = await identity(admin, await readFile(f.authFile, "utf8")),
        e = await event(admin);
      await association(admin, owner.owner, e.id);
      async function api(path: string, method = "GET", body?: unknown) {
        const response = await fetch(f.baseUrl + path, {
          method,
          headers: {
            Cookie: owner.cookie,
            Origin: f.baseUrl,
            "Content-Type": "application/json",
            "X-Capture-Contract": "share-work-v1",
            "Idempotency-Key": randomUUID(),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.ok(response.ok, `${path}: ${response.status}`);
        return response.json();
      }
      async function create(title: string) {
        const { draft } = await api("/api/v1/drafts", "POST", { event_id: e.id });
        await api(`/api/v1/drafts/${draft.id}`, "PATCH", {
          expected_version: 1,
          fields: {
            ...emptyProject,
            title,
            problem: "A problem",
            description: "An owner's saved content",
          },
          review_source: { method: "typed" },
        });
        return draft.id as string;
      }
      const id = await create("Delete my draft"),
        publicId = await create("Delete my public project");
      const r = await api(`/api/v1/projects/${publicId}/publication-review`, "POST", {
        expected_version: 2,
        public_author: {
          display_name: "Fixture owner",
          contact: { kind: "email", value: "fixture@example.test" },
        },
        include: { project_link: false, repository_link: false, details: false },
      });
      await api(`/api/v1/projects/${publicId}/publish`, "POST", { review_id: r.review_id });
      const context = await browser.newContext({ viewport });
      await context.addCookies([
        {
          name: "brag.session_token",
          value: owner.cookie.slice("brag.session_token=".length),
          url: f.baseUrl,
        },
      ]);
      const page = await context.newPage();
      try {
        await page.goto(f.baseUrl + "/my/projects");
        await page.getByRole("button", { name: "Delete my draft", exact: true }).click();
        await page.getByLabel("Project name", { exact: true }).fill("Keep this unsaved edit");
        await page.getByRole("button", { name: "Delete project", exact: true }).click();
        await page.getByRole("button", { name: "Keep project", exact: true }).click();
        await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
          "Keep this unsaved edit",
        );
        await page.getByRole("button", { name: "Delete project", exact: true }).click();
        let dropped = false;
        await page.route(`**/api/v1/projects/${id}`, async (route) => {
          if (route.request().method() === "DELETE" && !dropped) {
            dropped = true;
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            await route.abort("failed");
          } else await route.continue();
        });
        await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Check deletion", exact: true }),
        ).toBeVisible();
        // Reload when GET draft already returns 404: only the stored receipt identifies success.
        await page.reload();
        await expect(page).toHaveURL(f.baseUrl + "/my/projects");
        await expect(page.getByText("Project deleted.", { exact: true })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Delete my draft", exact: true }),
        ).toHaveCount(0);
        await page.getByRole("button", { name: "Delete my public project", exact: true }).click();
        await expect(page).toHaveURL(f.baseUrl + `/my/projects/${publicId}`);
        await page.getByRole("button", { name: "Delete project", exact: true }).click();
        await expect(
          page.getByText("The public project page and its event listings will also be removed."),
        ).toBeVisible();
        await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
        await expect(page).toHaveURL(f.baseUrl + "/my/projects");
        await expect(
          page.getByRole("heading", { name: "Your first project starts here.", exact: true }),
        ).toBeVisible();
        assert.equal((await fetch(f.baseUrl + `/api/v1/projects/${publicId}`)).status, 404);
        const other = await identity(admin, await readFile(f.authFile, "utf8"));
        await context.clearCookies();
        await context.addCookies([
          {
            name: "brag.session_token",
            value: other.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        await page.goto(f.baseUrl + `/my/projects/${publicId}`);
        await expect(
          page.getByRole("heading", { name: "Project unavailable.", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Delete project", exact: true })).toHaveCount(
          0,
        );
      } finally {
        await context.close();
      }
    });
});
