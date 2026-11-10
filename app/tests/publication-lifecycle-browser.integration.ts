import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, association } from "./fixtures/sharing-history.ts";
import { emptyProject } from "../src/projects/model.ts";

test("real lifecycle controller with retained edits and exact recovery", async (t) => {
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
    await t.test(`${viewport.width}px update, withdrawal, republish and delete`, async () => {
      const owner = await identity(admin, await readFile(f.authFile, "utf8")),
        e = await event(admin);
      await association(admin, owner.owner, e.id);
      async function api(path: string, method = "GET", body?: unknown) {
        const r = await fetch(f.baseUrl + path, {
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
        assert.ok(r.ok, `${method} ${path}: ${r.status}`);
        return r.json();
      }
      let { draft } = await api("/api/v1/drafts", "POST", { event_id: e.id });
      ({ draft } = await api(`/api/v1/drafts/${draft.id}`, "PATCH", {
        expected_version: draft.version,
        fields: {
          ...emptyProject,
          title: "Lifecycle fixture",
          problem: "Offline notes",
          description: "Original public description",
          project_url: "https://example.test/public",
          repository_url: "https://example.test/private",
        },
        review_source: { method: "typed" },
      }));
      const review = await api(`/api/v1/projects/${draft.id}/publication-review`, "POST", {
        expected_version: draft.version,
        public_author: {
          display_name: "Maker",
          contact: { kind: "profile", value: "https://example.test/maker" },
        },
        include: { project_link: true, repository_link: false, details: false },
      });
      await api(`/api/v1/projects/${draft.id}/publish`, "POST", { review_id: review.review_id });
      const context = await browser.newContext({ viewport });
      await context.addCookies([
        {
          name: "brag.session_token",
          value: owner.cookie.slice("brag.session_token=".length),
          url: f.baseUrl,
        },
      ]);
      const page = await context.newPage();
      const main = page.locator("main");
      try {
        await page.goto(f.baseUrl + "/my/projects");
        await page.getByRole("button", { name: "Lifecycle fixture", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Edit your project.", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Delete project", exact: true }),
        ).toBeVisible();
        const description = page.getByLabel("What did you build?", { exact: true });
        await description.fill("Working private description");
        await context.clearCookies();
        await page
          .getByRole("button", { name: "Save and choose public details", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Sign in to continue.", exact: true }),
        ).toBeVisible();
        await expect(description).toHaveCount(0);
        await context.addCookies([
          {
            name: "brag.session_token",
            value: owner.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(description).toHaveValue("Working private description");

        await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
        await page.getByRole("button", { name: "Keep published", exact: true }).click();
        await expect(description).toHaveValue("Working private description");
        await page.getByRole("button", { name: "Delete project", exact: true }).click();
        await page.getByRole("button", { name: "Keep project", exact: true }).click();
        await expect(description).toHaveValue("Working private description");
        await page.getByRole("button", { name: "View current public page", exact: true }).click();
        await expect(page.getByText("Original public description", { exact: true })).toBeVisible();
        await expect(page.getByText("Working private description", { exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Back to private editor", exact: true }).click();
        // Concurrent save must not silently replace local edits.
        const saved = (await api(`/api/v1/drafts/${draft.id}`)).draft;
        await api(`/api/v1/drafts/${draft.id}`, "PATCH", {
          expected_version: saved.version,
          fields: { ...saved.fields, description: "Saved elsewhere" },
          review_source: { method: "typed" },
        });
        await page
          .getByRole("button", { name: "Save and choose public details", exact: true })
          .click();
        await page.getByRole("button", { name: "Review latest state", exact: true }).click();
        await expect(description).toHaveValue("Working private description");
        await page
          .getByLabel("Project link (optional)", { exact: true })
          .fill("https://example.test/new-private-link");
        await page
          .getByRole("button", { name: "Save and choose public details", exact: true })
          .click();
        await expect(page.getByLabel("Public display name")).toHaveValue("Maker");
        await expect(page.getByLabel("Public profile link", { exact: true })).toHaveValue(
          "https://example.test/maker",
        );
        await page.getByRole("button", { name: "Review public page", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Review your update.", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("https://example.test/new-private-link", { exact: true }),
        ).toHaveCount(0);
        await page.getByLabel("I reviewed this version and its public contact details.").check();
        await page.route("**/api/v1/projects/*/publish", async (route) => {
          await route.fetch();
          await route.abort("failed");
        });
        await page.getByRole("button", { name: "Publish update", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Result not yet confirmed.", exact: true }),
        ).toBeVisible();
        await page.unroute("**/api/v1/projects/*/publish");
        await page.reload();
        await page.getByRole("button", { name: "Check result", exact: true }).click();
        await expect(page.getByText("Published · version 2", { exact: true })).toBeVisible();
        assert.equal(
          (await api(`/api/v1/projects/${draft.id}`)).project.content.description,
          "Working private description",
        );
        await description.fill("Unsaved through withdrawal");
        await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
        await page.route("**/api/v1/projects/*/withdraw", async (route) => {
          await route.fetch();
          await route.abort("failed");
        });
        await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Result not yet confirmed.", exact: true }),
        ).toBeVisible();
        await page.unroute("**/api/v1/projects/*/withdraw");
        await page.getByRole("button", { name: "Check result", exact: true }).click();
        await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
        await expect(description).toHaveValue("Unsaved through withdrawal");
        assert.equal((await fetch(f.baseUrl + `/api/v1/projects/${draft.id}`)).status, 404);
        await expect(
          page.getByRole("button", { name: "Delete project", exact: true }),
        ).toBeVisible();
        await mkdir(".localfiles/runtime-evidence", { recursive: true });
        await page.screenshot({
          path: `.localfiles/runtime-evidence/lifecycle-withdrawn-${viewport.width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Save and choose public details", exact: true })
          .click();
        await page.getByRole("button", { name: "Review public page", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Publish again", exact: true }),
        ).toBeDisabled();
        await page.getByLabel("I reviewed this version and its public contact details.").check();
        await page.getByRole("button", { name: "Publish again", exact: true }).click();
        await expect(page.getByText("Published · version 3", { exact: true })).toBeVisible();
        assert.equal(
          (await api(`/api/v1/projects/${draft.id}`)).project.content.description,
          "Unsaved through withdrawal",
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await description.fill("Sensitive unsaved text for original owner");
        const other = await identity(admin, await readFile(f.authFile, "utf8"));
        await context.addCookies([
          {
            name: "brag.session_token",
            value: other.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(
          page.getByRole("heading", { name: "Project unavailable.", exact: true }),
        ).toBeVisible();
        await expect(description).toHaveCount(0);
        await context.addCookies([
          {
            name: "brag.session_token",
            value: owner.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(description).toHaveValue("Unsaved through withdrawal");

        await page.getByRole("button", { name: "Delete project", exact: true }).click();
        await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
        await expect(page).toHaveURL(/\/my\/projects$/);
        assert.equal((await fetch(f.baseUrl + `/api/v1/projects/${draft.id}`)).status, 404);
        await expect(main.getByText("Project deleted.", { exact: true })).toBeVisible();
      } finally {
        await context.close();
      }
    });
});
