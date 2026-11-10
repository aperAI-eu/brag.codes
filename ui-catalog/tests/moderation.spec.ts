import { test, expect, type Page } from "@playwright/test";
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function open(page: Page, name = "Offline notes") {
  await page.goto("./#moderation");
  await button(page, `Review ${name}`).click();
}
async function scenario(page: Page, name: string) {
  const summary = page.getByText("Fictional scenario controls", { exact: true });
  if (!(await button(page, name).isVisible())) await summary.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await button(page, name).click();
}

test("search, filters, pagination and retained list state use approved content only", async ({
  page,
  baseURL,
}, info) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./#moderation");
  await expect(button(page, "Review Tiny garden")).toHaveCount(0);
  await button(page, "Load more").click();
  await expect(button(page, "Review Tiny garden")).toBeVisible();
  await page.getByLabel("Event", { exact: true }).selectOption("Prague Builders");
  await page.getByLabel("Visibility", { exact: true }).selectOption("hidden");
  await expect(button(page, "Review Community map")).toBeVisible();
  await expect(button(page, "Review Offline notes")).toHaveCount(0);
  await page.getByLabel("Search published content").fill("no matching title");
  await expect(page.getByRole("heading", { name: "No matching projects" })).toBeVisible();
  await button(page, "Clear filters").click();
  await page.getByLabel("Search published content").fill("Offline");
  await button(page, "Review Offline notes").click();
  await expect(page.getByText("Project ID: demo-project-1")).toBeVisible();
  await button(page, "Back to moderation").click();
  await expect(page.getByLabel("Search published content")).toHaveValue("Offline");
  await page.screenshot({
    path: `.localfiles/screenshots/moderation-list-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("keyboard confirmation, cancellation, hide and restore record each reason once", async ({
  page,
}, info) => {
  await open(page);
  await button(page, "Hide project").focus();
  await page.keyboard.press("Enter");
  await expect(button(page, "Confirm hide")).toBeDisabled();
  await page.getByLabel("Reason", { exact: true }).fill("   ");
  await expect(button(page, "Confirm hide")).toBeDisabled();
  await page.getByLabel("Reason", { exact: true }).fill("Unsent reason");
  await button(page, "Cancel and discard reason").click();
  await expect(page.getByText("No moderation actions yet.")).toBeVisible();
  await button(page, "Hide project").click();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("");
  await page.getByLabel("Reason", { exact: true }).fill("Misleading description.");
  await page.screenshot({
    path: `.localfiles/screenshots/moderation-confirm-${info.project.name}.png`,
    fullPage: true,
  });
  await button(page, "Confirm hide").click();
  await expect(page.getByText("Project hidden from visitors and agents.")).toBeVisible();
  await expect(page.getByText("Misleading description.", { exact: true })).toHaveCount(1);
  await page.screenshot({
    path: `.localfiles/screenshots/moderation-hidden-${info.project.name}.png`,
    fullPage: true,
  });
  await button(page, "Restore project").click();
  await page.getByLabel("Reason", { exact: true }).fill("Reviewed and cleared.");
  await button(page, "Confirm restore").click();
  await expect(page.getByText("Project restored to public discovery.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(2);
});

test("restore respects owner withdrawal and requires review after concurrent change", async ({
  page,
}, info) => {
  await open(page, "Community map");
  await button(page, "Restore project").click();
  await page.getByLabel("Reason", { exact: true }).fill("Cleared by review.");
  await scenario(page, "Author withdraws project");
  await button(page, "Confirm restore").click();
  await expect(page.getByRole("heading", { name: "This project changed." })).toBeVisible();
  await button(page, "Review latest state").click();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Cleared by review.");
  await expect(
    page.getByText(/Removing the moderation restriction will keep it withdrawn/),
  ).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/moderation-withdrawn-${info.project.name}.png`,
    fullPage: true,
  });
  await button(page, "Confirm restore").click();
  await expect(
    page.getByText("Restriction removed. The project remains withdrawn by its author."),
  ).toBeVisible();
  await expect(page.getByText("Withdrawn by author", { exact: true })).toBeVisible();
});

test("failed action retains reason, lost response freezes intent and reconciles one audit entry", async ({
  page,
}) => {
  await open(page);
  await button(page, "Hide project").click();
  await page.getByLabel("Reason", { exact: true }).fill("Review this claim.");
  await scenario(page, "Fail next action");
  await button(page, "Confirm hide").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("not saved");
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Review this claim.");
  await scenario(page, "Lose next response");
  await button(page, "Confirm hide").click();
  await expect(page.getByRole("heading", { name: "Check the result first." })).toBeVisible();
  await expect(button(page, "Confirm hide")).toHaveCount(0);
  await button(page, "Check result").click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("Review this claim.", { exact: true })).toHaveCount(1);
});

test("session expiry hides managed data, retains unsent reason and rechecks state", async ({
  page,
}) => {
  await open(page);
  await button(page, "Hide project").click();
  await page.getByLabel("Reason", { exact: true }).fill("Retain for review.");
  await scenario(page, "Expire session");
  await expect(page.getByRole("heading", { name: "Sign in again." })).toBeVisible();
  await expect(page.getByText("Offline notes", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
  await button(page, "Resume as Jan Demo").click();
  await button(page, "Review latest state").click();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Retain for review.");
  await scenario(page, "Revoke admin role");
  await expect(page.getByRole("heading", { name: "Moderation access unavailable." })).toBeVisible();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
});

test("deletion prevents restore; reset and reload discard fixture state", async ({ page }) => {
  await open(page, "Community map");
  await button(page, "Restore project").click();
  await page.getByLabel("Reason", { exact: true }).fill("Old review");
  await scenario(page, "Author deletes project");
  await expect(
    page.getByText("The project was deleted by its author. There is nothing to restore."),
  ).toBeVisible();
  await expect(button(page, "Review Community map")).toHaveCount(0);
  await button(page, "Reset moderation preview").click();
  await button(page, "Review Community map").click();
  await button(page, "Restore project").click();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("");
  await page.getByLabel("Reason", { exact: true }).fill("Reload discards this");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Review public projects." })).toBeVisible();
});

test("empty, loading and unavailable list states have working recovery", async ({ page }) => {
  await page.goto("./#moderation");
  await scenario(page, "Simulate loading");
  await expect(page.getByRole("heading", { name: "Loading moderation…" })).toBeVisible();
  await button(page, "Finish simulated load").click();
  await scenario(page, "Simulate offline load");
  await expect(button(page, "Review Offline notes")).toHaveCount(0);
  await button(page, "Retry load").click();
  await scenario(page, "Simulate empty list");
  await expect(page.getByRole("heading", { name: "No matching projects" })).toBeVisible();
  await button(page, "Clear filters").click();
  await expect(button(page, "Review Offline notes")).toBeVisible();
});
