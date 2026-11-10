import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/#optional-event");
});

test("event choice stays explicit with zero, one or many linked events", async ({ page }) => {
  for (const count of ["0", "1", "2"]) {
    await page.getByLabel("Linked events", { exact: true }).selectOption(count);
    await expect(page.getByRole("button", { name: "Scan event QR", exact: true })).toBeVisible();
    const skip = page.getByRole("button", { name: "Continue without an event", exact: true });
    await expect(skip).toBeVisible();
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("No event linked", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to brag" }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("optional-event.png"), fullPage: true });
});

test("typed no-event draft survives back and explicit resume", async ({ page }) => {
  await page.getByRole("button", { name: "Continue without an event" }).click();
  await page.getByRole("button", { name: /Type it in/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Independent project");
  await page.getByLabel("What did you build?", { exact: true }).fill("A small useful tool.");
  await page.getByRole("button", { name: "Back to brag" }).click();
  await page.getByRole("button", { name: "Resume unfinished project" }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Independent project");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
  await expect(page.getByText(/private draft with no event linked/)).toBeVisible();
});

test("QR error and cancellation never require an event", async ({ page }) => {
  await page.getByRole("button", { name: "Scan event QR", exact: true }).click();
  const scanner = page.locator(".event-scanner");
  const skip = scanner.getByRole("button", { name: "Continue without an event" });
  await expect(skip).toBeVisible();
  const cameraBox = await scanner.getByRole("button", { name: "Start camera" }).boundingBox();
  const skipBox = await skip.boundingBox();
  const formBox = await scanner.locator("form").boundingBox();
  expect(cameraBox).not.toBeNull();
  expect(skipBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(Math.abs(skipBox!.x - cameraBox!.x)).toBeLessThan(2);
  expect(Math.abs(skipBox!.width - cameraBox!.width)).toBeLessThan(2);
  expect(skipBox!.y).toBeGreaterThanOrEqual(cameraBox!.y + cameraBox!.height);
  expect(skipBox!.y + skipBox!.height).toBeLessThanOrEqual(formBox!.y);
  await page.screenshot({ path: test.info().outputPath("scanner-placement.png"), fullPage: true });
  await page.getByLabel("Or paste the event link").fill("unknown");
  await page.getByRole("button", { name: "Find event", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Event not found" })).toContainText(
    "Event not found",
  );
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("No event linked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to brag" }).click();
  await page.getByRole("button", { name: "Scan event QR", exact: true }).click();
  await page.getByRole("button", { name: "Back to brag" }).click();
  await expect(page.getByRole("button", { name: "Continue without an event" })).toBeVisible();
  await page.getByRole("button", { name: "Scan event QR", exact: true }).click();
  await page.getByRole("button", { name: "Simulate valid event QR" }).click();
  await expect(page.getByText("Bratislava Demo Night", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to brag" }).click();
  await page.getByRole("button", { name: "Continue without an event" }).click();
  await expect(page.getByText("No event linked", { exact: true })).toBeVisible();
});

for (const method of ["voice", "agent"])
  test(`${method} proposal can be reviewed and saved without an event`, async ({ page }) => {
    await page.getByRole("button", { name: "Continue without an event" }).click();
    if (method === "voice") {
      await page.getByRole("button", { name: /Record your pitch/ }).click();
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      await page.getByRole("button", { name: "Pause recording", exact: true }).click();
      await page.getByRole("button", { name: "Finish pitch", exact: true }).click();
    } else {
      await page.getByRole("button", { name: /Use your AI agent/ }).click();
      await page.getByRole("button", { name: "Simulate agent upload" }).click();
    }
    await expect(page.getByRole("heading", { name: "Review your project." })).toBeVisible();
    await expect(page.getByText(/Received during the submission window/)).toHaveCount(0);
    await page.getByRole("button", { name: "Approve and save draft" }).click();
    await expect(page.getByText(/private draft with no event linked/)).toBeVisible();
    await page.getByRole("button", { name: "Share another project" }).click();
    await expect(page.getByRole("button", { name: "Continue without an event" })).toBeVisible();
  });

test("footer attribution and shared admin API setup navigation", async ({ page }) => {
  const link = page.getByRole("link", { name: "Powered by aperAI" });
  await expect(link).toHaveAttribute("href", "https://aperai.eu/");
  await expect(link.locator("svg")).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Admin workspace" }).click();
  const setup = page.getByRole("link", { name: "API setup", exact: true });
  await setup.focus();
  await page.keyboard.press("Enter");
  await expect(setup).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Pitch integrations" })).toBeVisible();
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admin events" })).toBeVisible();
});
