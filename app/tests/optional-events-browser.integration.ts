import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, association } from "./fixtures/sharing-history.ts";

test("real no-event entry, capture, publication and scanner navigation", async (t) => {
  const f = await ownedFixture();
  const migration = migrateCandidate(f);
  assert.equal(migration.status, 0, migration.output);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await admin.end();
  });
  for (const width of [390, 1440])
    await t.test(
      `${width}px: optional event is explicit and persists through publication`,
      async () => {
        const owner = await identity(admin, await readFile(f.authFile, "utf8"));
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        await context.addCookies([
          {
            name: "brag.session_token",
            value: owner.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        const page = await context.newPage();
        try {
          await page.goto(f.baseUrl + "/share");
          await expect(page.getByRole("heading", { name: "Sharing at an event?" })).toBeVisible();
          await expect(page.getByRole("link", { name: "Powered by aperAI" })).toHaveAttribute(
            "href",
            "https://aperai.eu/",
          );
          const e = await event(admin);
          await association(admin, owner.owner, e.id);
          await page.reload();
          await expect(page.getByRole("heading", { name: "Sharing at an event?" })).toBeVisible();
          await page.getByRole("button", { name: "Scan event QR", exact: true }).click();
          await expect(
            page
              .locator(".event-scanner")
              .getByRole("button", { name: "Continue without an event" }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Continue without an event" }).click();
          await expect(page).toHaveURL(f.baseUrl + "/submit");
          await page.getByRole("button", { name: /Type it in/ }).click();
          await page
            .getByLabel("Project name", { exact: true })
            .fill("No-event browser project " + width);
          await page
            .getByLabel("What problem does it solve?", { exact: true })
            .fill("Finding shared tools");
          await page
            .getByLabel("What did you build?", { exact: true })
            .fill("A shared neighbourhood tool directory");
          await page.getByRole("button", { name: "Back to my projects", exact: true }).click();
          await page.getByRole("button", { name: /Resume/ }).click();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
            "No-event browser project " + width,
          );
          await page.getByRole("button", { name: "Save draft", exact: true }).click();
          await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
          assert.match(page.url(), /\/submit\/[a-f0-9-]{36}$/);
          const id = page.url().split("/").pop()!;
          assert.equal(
            (await admin.query("SELECT event_id FROM brag.project_draft WHERE id=$1", [id])).rows[0]
              .event_id,
            null,
          );
          await page.goto(f.baseUrl + "/my/projects");
          await page
            .getByRole("button", { name: "No-event browser project " + width, exact: true })
            .click();
          await expect(page.getByText("No event linked", { exact: true })).toBeVisible();
          await page.screenshot({
            path: `.localfiles/optional-event-editor-${width}.png`,
            fullPage: true,
          });
          await page.getByRole("button", { name: "Continue to publication", exact: true }).click();
          await page.getByRole("button", { name: "Continue to publication", exact: true }).click();
          await page.getByLabel("Public display name").fill("Independent maker");
          await page
            .getByLabel("Public profile link", { exact: true })
            .fill("https://example.test/maker");
          await page.getByRole("button", { name: "Review public page", exact: true }).click();
          await page
            .getByLabel("I have reviewed this project and the public contact details.")
            .check();
          await page.getByRole("button", { name: "Publish project", exact: true }).click();
          await expect(page.getByRole("button", { name: "View Slop Gallery" })).toBeVisible();
          await page.getByRole("button", { name: "View public project", exact: true }).click();
          await expect(page.getByRole("link", { name: "Slop Gallery", exact: true })).toBeVisible();
          await page.screenshot({
            path: `.localfiles/optional-event-public-${width}.png`,
            fullPage: true,
          });
          assert.equal(
            (await fetch(f.baseUrl + "/api/v1/projects/" + id).then((r) => r.json())).project
              .event_id,
            null,
          );
          await page.goto(f.baseUrl + "/my/projects");
          await page
            .getByRole("button", { name: "No-event browser project " + width, exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "Delete project", exact: true }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Delete project", exact: true }).click();
          await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
          await expect(page).toHaveURL(f.baseUrl + "/my/projects");
          assert.equal((await fetch(f.baseUrl + "/api/v1/projects/" + id)).status, 404);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        } finally {
          await context.close();
        }
      },
    );
});
