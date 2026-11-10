import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event, association } from "./fixtures/sharing-history.ts";
import { emptyProject } from "../src/projects/model.ts";
test("real admin moderation and public visibility", async (t) => {
  const f = await ownedFixture();
  assert.equal(migrateCandidate(f).status, 0);
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await admin.end();
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ])
    await t.test(
      `${viewport.width}px moderation, stale review, session and receipt recovery`,
      async () => {
        const secret = await readFile(f.authFile, "utf8"),
          owner = await identity(admin, secret),
          moderator = await identity(admin, secret),
          e = await event(admin);
        await admin.query(
          'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES($1,true,1,now())',
          [moderator.owner],
        );
        await association(admin, owner.owner, e.id);
        async function api(path: string, method = "GET", body?: unknown, cookie = owner.cookie) {
          const r = await fetch(f.baseUrl + path, {
            method,
            headers: {
              Cookie: cookie,
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
          expected_version: 1,
          fields: {
            ...emptyProject,
            title: `Moderation ${viewport.width}`,
            problem: "A public problem",
            description: "Approved description",
          },
          review_source: { method: "typed" },
        }));
        const r = await api(`/api/v1/projects/${draft.id}/publication-review`, "POST", {
          expected_version: 2,
          public_author: {
            display_name: "Public builder",
            contact: { kind: "profile", value: "https://example.test/author" },
          },
          include: { project_link: false, repository_link: false, details: false },
        });
        await api(`/api/v1/projects/${draft.id}/publish`, "POST", { review_id: r.review_id });
        const context = await browser.newContext({ viewport });
        const cookie = {
          name: "brag.session_token",
          value: moderator.cookie.slice("brag.session_token=".length),
          url: f.baseUrl,
        };
        await context.addCookies([cookie]);
        const page = await context.newPage(),
          button = (name: string) => page.getByRole("button", { name, exact: true });
        try {
          await page.goto(f.baseUrl + "/admin");
          await page.getByRole("link", { name: "Moderation", exact: true }).click();
          await page.getByLabel("Search published content").fill(`Moderation ${viewport.width}`);
          await button(`Review Moderation ${viewport.width}`).click();
          await button("Hide project").click();
          await page.getByLabel("Reason", { exact: true }).fill("Retained admin reason");
          await context.clearCookies();
          await button("Confirm hide").click();
          await expect(
            page.getByRole("heading", { name: "Sign in again.", exact: true }),
          ).toBeVisible();
          await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
          await context.addCookies([cookie]);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await button("Review latest state").click();
          await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
            "Retained admin reason",
          );
          await page.route("**/api/v1/projects/*/moderation", async (route) => {
            await route.fetch();
            await route.abort("failed");
          });
          await button("Confirm hide").click();
          await expect(
            page.getByRole("heading", { name: "Check the result first.", exact: true }),
          ).toBeVisible();
          await page.unroute("**/api/v1/projects/*/moderation");
          const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
          assert.ok(!stored.includes("Retained admin reason"));
          await page.reload();
          await button("Check result").click();
          await expect(button("Restore project")).toBeVisible();
          assert.equal((await fetch(f.baseUrl + `/api/v1/projects/${draft.id}`)).status, 404);
          assert.equal(
            (
              await api(
                `/api/v1/admin/moderation/projects/${draft.id}`,
                "GET",
                undefined,
                moderator.cookie,
              )
            ).history.length,
            1,
          );
          await button("Restore project").click();
          await page.getByLabel("Reason", { exact: true }).fill("Reviewed again");
          const saved = (await api(`/api/v1/drafts/${draft.id}`)).draft;
          const state = (await api(`/api/v1/projects/${draft.id}/publication-state`)).publication;
          await api(`/api/v1/projects/${draft.id}/withdraw`, "POST", {
            expected_version: saved.version,
            expected_publication_revision: state.revision,
          });
          await button("Confirm restore").click();
          await button("Review latest state").click();
          await expect(
            page.getByText(/Removing the moderation restriction will keep it withdrawn/),
          ).toBeVisible();
          await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Reviewed again");
          await button("Confirm restore").click();
          await expect(page.getByText("Withdrawn by author", { exact: true })).toBeVisible();
          assert.equal((await fetch(f.baseUrl + `/api/v1/projects/${draft.id}`)).status, 404);
          await page.screenshot({
            path: `.localfiles/runtime-evidence/moderation-${viewport.width}.png`,
            fullPage: true,
          });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await button("Hide project").click();
          await page.getByLabel("Reason", { exact: true }).fill("Will not be committed");
          await admin.query('UPDATE brag.platform_role SET active=false WHERE "userId"=$1', [
            moderator.owner,
          ]);
          await button("Confirm hide").click();
          await expect(
            page.getByRole("heading", { name: "Moderation access unavailable.", exact: true }),
          ).toBeVisible();
          await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
          assert.equal(
            (
              await admin.query(
                "SELECT count(*)::int n FROM brag.moderation_audit WHERE project_id=$1",
                [draft.id],
              )
            ).rows[0].n,
            2,
          );
        } finally {
          await context.close();
        }
      },
    );
});
