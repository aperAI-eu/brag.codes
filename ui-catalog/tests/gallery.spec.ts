import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("public browsing, pagination and detail preserve search and event context", async ({
  page,
}, info) => {
  await page.goto("/#gallery");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Slop Gallery", exact: true })).toBeVisible();
  await expect(main.locator(".gallery-card")).toHaveCount(2);
  await main.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(main.locator(".gallery-card")).toHaveCount(4);
  await page.getByLabel("Search projects", { exact: true }).fill("offline");
  await page.getByLabel("Event", { exact: true }).selectOption("bratislava");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await expect(main.locator(".gallery-card")).toHaveCount(1);
  await expect(main.getByText("Matched in title, description")).toBeVisible();
  await main.getByRole("button", { name: "Offline notes", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { name: "Offline notes", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Public profile", exact: true })).toBeVisible();
  await expect(main.getByText("Repository", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Back to gallery", exact: true }).click();
  await expect(page.getByLabel("Search projects", { exact: true })).toHaveValue("offline");
  await expect(page.getByLabel("Event", { exact: true })).toHaveValue("bratislava");
  await page.getByRole("button", { name: "Reset gallery", exact: true }).click();
  await mkdir(".localfiles/screenshots", { recursive: true });
  await page.screenshot({
    path: `.localfiles/screenshots/req021-gallery-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("empty, no matches, unavailable and throttled states stay distinct", async ({ page }) => {
  await page.goto("/#gallery");
  const main = page.getByRole("main");
  await page.getByLabel("Search projects", { exact: true }).fill("not-a-match");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await expect(main.getByRole("heading", { name: "No matching projects yet." })).toBeVisible();
  await main.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(main.locator(".gallery-card")).toHaveCount(2);
  await page.getByLabel("Scenario", { exact: false }).selectOption("unavailable");
  await main.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("The gallery couldn’t load.");
  await expect(main.getByRole("heading", { name: "No matching projects yet." })).toHaveCount(0);
  await page.getByLabel("Scenario", { exact: false }).selectOption("limited");
  await main.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Wait a minute");
  await page.getByLabel("Scenario", { exact: false }).selectOption("empty");
  await expect(main.getByRole("heading", { name: "Room for the first project." })).toBeVisible();
});

test("next-page failure retains results, removed detail stays unavailable and reset clears pending work", async ({
  page,
}) => {
  await page.goto("/#gallery");
  const main = page.getByRole("main");
  await page.getByLabel("Scenario", { exact: false }).selectOption("page-failure");
  await main.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Your current results are still here");
  await expect(main.locator(".gallery-card")).toHaveCount(2);
  await page.getByLabel("Scenario", { exact: false }).selectOption("normal");
  await main.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(main.locator(".gallery-card")).toHaveCount(4);
  await page.getByLabel("Scenario", { exact: false }).selectOption("removed");
  await main.getByRole("button", { name: "Offline notes", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Project unavailable." })).toBeVisible();
  await expect(main.getByRole("link", { name: "Public profile", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset gallery", exact: true }).click();
  await expect(main.locator(".gallery-card")).toHaveCount(2);
  await page.getByLabel("Scenario", { exact: false }).selectOption("loading");
  await expect(main.getByRole("status")).toHaveText("Loading published projects…");
  await page.getByRole("button", { name: "Reset gallery", exact: true }).click();
  await expect(main.locator(".gallery-card")).toHaveCount(2);
});

test("agent guide copies bounded read-only instructions and shows public-only JSON", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => {} },
    }),
  );
  await page.goto("/#gallery");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "For agents", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Let your agent explore." })).toBeVisible();
  await expect(page.getByLabel("Discovery instructions · v1")).toHaveValue(
    /at most 3 result pages/,
  );
  await main.getByRole("button", { name: "Copy instructions", exact: true }).click();
  await expect(main.getByRole("status")).toHaveText("Instructions copied.");
  await mkdir(".localfiles/screenshots", { recursive: true });
  await page.screenshot({
    path: `.localfiles/screenshots/req021-agents-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await main.getByRole("button", { name: "View example JSON", exact: true }).click();
  const data = JSON.parse(await main.getByLabel("Public JSON response").innerText());
  expect(data.schema_version).toBe(1);
  expect(data.projects).toHaveLength(2);
  expect(Object.keys(data.projects[0].content.author)).toEqual(["name"]);
  await main.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Scenario", { exact: false }).selectOption("copy-failure");
  await main.getByRole("button", { name: "Copy instructions", exact: true }).click();
  await expect(main.getByRole("status")).toContainText("Select and copy");
  await page.getByLabel("Scenario", { exact: false }).selectOption("json-failure");
  await main.getByRole("button", { name: "View example JSON", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Couldn’t load public JSON");
  await page.getByLabel("Scenario", { exact: false }).selectOption("normal");
  await main.getByRole("button", { name: "View example JSON", exact: true }).click();
  await expect(main.getByLabel("Public JSON response")).toBeVisible();
});

test("event choices can load another bounded page without changing the selected scope", async ({
  page,
}) => {
  await page.goto("/#gallery");
  await page.getByLabel("Scenario", { exact: false }).selectOption("more-events");
  const event = page.getByLabel("Event", { exact: true });
  await expect(event.locator("option")).toHaveCount(3);
  await event.selectOption("__more");
  await expect(event.locator("option")).toHaveCount(3);
  await expect(event).toHaveValue("");
  await event.selectOption("prague");
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("main").locator(".gallery-card")).toHaveCount(2);
});
