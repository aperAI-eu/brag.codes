import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("cancel preserves unsaved content and keyboard focus; deletion removes only the selected project", async ({
  page,
}, info) => {
  await page.goto("/#delete-project");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Offline notes", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Unsaved owner idea");
  const trigger = main.getByRole("button", { name: "Delete project", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { name: "Offline notes", exact: true })).toBeVisible();
  await expect(main.getByText("You have unsaved changes.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Unsaved owner idea");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await main.getByRole("button", { name: "Keep project", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Unsaved owner idea");
  await trigger.click();
  await mkdir(".localfiles/screenshots", { recursive: true });
  await page.screenshot({
    path: `.localfiles/screenshots/req020-private-${info.project.name}.png`,
    fullPage: true,
  });
  await main.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(main.getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled();
  await expect(main.getByRole("status")).toHaveText("Project deleted.");
  await expect(main.getByRole("button", { name: "Offline notes", exact: true })).toHaveCount(0);
  await expect(
    main.getByRole("button", { name: "Community garden map", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Voice project in progress", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("published deletion explains public removal and lost responses require reconciliation", async ({
  page,
}, info) => {
  await page.goto("/#delete-project");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Community garden map", exact: true }).click();
  await main.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(
    main.getByText("The public project page and its event listings will also be removed."),
  ).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/req020-public-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("Deletion result").selectOption("lost");
  await main.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(main.getByRole("button", { name: "Check deletion", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
  await expect(main.getByText("Project deleted.", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Check deletion", exact: true }).click();
  await expect(main.getByRole("status")).toHaveText("Project deleted.");
  await expect(main.getByRole("button", { name: "Community garden map", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Reset deletion preview", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Community garden map", exact: true }),
  ).toBeVisible();
});

test("failure preserves project and stale state requires fresh review", async ({ page }) => {
  await page.goto("/#delete-project");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Voice project in progress", exact: true }).click();
  await main.getByRole("button", { name: "Delete project", exact: true }).click();
  await page.getByLabel("Deletion result").selectOption("failure");
  await main.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Nothing was changed");
  await page.getByLabel("Deletion result").selectOption("conflict");
  await main.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("changed in another tab");
  await expect(main.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
  await main.getByRole("button", { name: "Review latest project", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Updated project from another tab",
  );
  await main.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Updated project from another tab", exact: true }),
  ).toBeVisible();
});

test("expiry and unavailable access hide content; final deletion yields the empty state", async ({
  page,
}) => {
  await page.goto("/#delete-project");
  const main = page.getByRole("main");
  await page.getByRole("button", { name: "Only one project", exact: true }).click();
  await main.getByRole("button", { name: "Offline notes", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Retained private idea");
  await page.getByRole("button", { name: "Expire session", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Sign in to continue.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Sign in to the same account", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Retained private idea",
  );
  await main.getByRole("button", { name: "Delete project", exact: true }).click();
  await main.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Your first project starts here.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simulate unavailable project", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Project unavailable.", exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
});
