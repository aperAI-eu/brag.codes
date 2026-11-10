import { test, expect } from "@playwright/test";

test("retained pitch needs explicit retry, then review and save", async ({ page }, info) => {
  await page.goto("./#recovery");
  const retry = page.getByRole("button", { name: "Retry retained recording", exact: true });
  await expect(retry).toBeDisabled();
  await page.getByLabel("Recovery scenario").selectOption("ready");
  await expect(retry).toBeEnabled();
  await page
    .getByRole("main")
    .screenshot({ path: `.localfiles/REQ-017/recovery-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Preparing your draft…" })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review your project." })).toBeVisible();
  await page.getByLabel("Project name", { exact: true }).fill("Recovered pitch");
  await page.getByRole("button", { name: "Approve and save draft" }).click();
  await expect(page.getByRole("heading", { name: "Draft saved." })).toBeVisible();
});

test("expiry, uncertainty, access and discard never promise an unavailable retry", async ({
  page,
}) => {
  await page.goto("./#recovery");
  const scenario = page.getByLabel("Recovery scenario");
  const access = page.getByLabel("Access scenario");
  const retry = page.getByRole("button", { name: "Retry retained recording", exact: true });
  await scenario.selectOption("uncertain");
  await expect(retry).toBeDisabled();
  await scenario.selectOption("ready");
  for (const state of ["closed", "suspended", "session"]) {
    await access.selectOption(state);
    await expect(retry).toBeDisabled();
  }
  await access.selectOption("");
  await page.getByRole("button", { name: "Discard recording", exact: true }).click();
  await page.getByRole("button", { name: "Keep recording" }).click();
  await expect(retry).toBeEnabled();
  await page.getByRole("button", { name: "Discard recording", exact: true }).click();
  await page.getByRole("button", { name: "Confirm discard" }).click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recording discarded." })).toBeVisible();
  await scenario.selectOption("expired");
  await expect(retry).toHaveCount(0);
  await page.getByRole("button", { name: "Continue by typing" }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("");
});

test("failed retries preserve the correct recovery source", async ({ page }) => {
  await page.goto("./#recovery");
  await page.getByLabel("Fail recovery attempt").check();
  await page.getByLabel("Recovery scenario").selectOption("ready");
  await page.getByRole("button", { name: "Retry retained recording", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("original expiry");
  await page.getByLabel("Recovery scenario").selectOption("transcript");
  await page.getByRole("button", { name: "Retry draft preparation" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "transcript is still available",
  );
  await expect(
    page.getByRole("button", { name: "Retry retained recording", exact: true }),
  ).toHaveCount(0);
});
