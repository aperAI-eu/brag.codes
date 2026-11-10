import { test, expect } from "@playwright/test";

test("public legal navigation is readable and keyboard accessible", async ({ page }) => {
  await page.goto("/#legal/privacy");
  await expect(page.getByRole("heading", { name: "Example Privacy Policy" })).toBeVisible();
  const terms = page
    .getByRole("navigation", { name: "Legal", exact: true })
    .getByRole("link", { name: "Terms of Service" });
  await terms.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Example Terms of Service" })).toBeVisible();
  await page.locator("article").getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Example Privacy Policy" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath("legal.png"),
    fullPage: true,
  });
});
