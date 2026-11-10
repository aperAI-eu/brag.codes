import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("hands current content to the agent and saves reviewed changes on the same project", async ({
  page,
}, info) => {
  await page.goto("/#refine");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your project draft." })).toBeVisible();
  await page.getByLabel("Project name", { exact: true }).fill("My unsaved improvement");
  await page.getByRole("button", { name: "Send to your agent", exact: true }).focus();
  await page.keyboard.press("Enter");
  const instruction = page.getByLabel("Agent instruction", { exact: true });
  await expect(instruction).toHaveValue(/My unsaved improvement/);
  await expect(instruction).toHaveValue(/11111111-2222-4333-8444-555555555555/);
  await expect(instruction).toHaveValue(/Base version: 3/);
  await mkdir(".localfiles/screenshots", { recursive: true });
  await page.screenshot({
    path: `.localfiles/screenshots/req019-handoff-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Simulate agent proposal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your agent’s changes." })).toBeVisible();
  await page.getByLabel("Project name", { exact: true }).fill("Owner reviewed refinement");
  await page.getByRole("button", { name: "Approve and save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Owner reviewed refinement",
  );
  await expect(
    main.getByText("11111111-2222-4333-8444-555555555555", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/req019-draft-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("cancellation, expiry and rejected proposals preserve owner content", async ({ page }) => {
  await page.goto("/#refine");
  await page.getByLabel("Project name", { exact: true }).fill("Keep this work");
  await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
  await page.getByRole("button", { name: "Expire instructions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "These upload instructions expired." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create new instructions", exact: true }).click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).toHaveValue(/Keep this work/);
  await page.getByRole("button", { name: "Cancel upload instructions", exact: true }).click();
  await page.getByRole("button", { name: "Back to my draft", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Keep this work");
  await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
  await page.getByRole("button", { name: "Simulate agent proposal", exact: true }).click();
  await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Keep this work");
});

test("blocks stale proposals and retains work through permission/status failures", async ({
  page,
}) => {
  await page.goto("/#refine");
  await page.getByLabel("Fail instruction preparation").check();
  await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Couldn’t prepare instructions",
  );
  await page.getByLabel("Fail instruction preparation").uncheck();
  await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
  await page.getByRole("button", { name: "Lose status connection", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copy agent instruction", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Check for proposal", exact: true }).click();
  await page.getByRole("button", { name: "Simulate agent proposal", exact: true }).click();
  await page.getByRole("button", { name: "Simulate newer owner edit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve and save draft", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Return to latest draft", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Newer owner draft");
  await page.getByLabel("Editing access unavailable").check();
  await expect(
    page.getByRole("button", { name: "Send to your agent", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reset refinement preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send to your agent", exact: true })).toBeEnabled();
});
