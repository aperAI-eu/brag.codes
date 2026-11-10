import { test, expect, type Page } from "@playwright/test";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function open(page: Page) {
  await page.goto("./#publish/start");
}
async function controls(page: Page) {
  const details = page
    .getByRole("complementary", { name: "Publication catalogue controls" })
    .locator("details");
  if (!(await details.evaluate((el) => el.hasAttribute("open"))))
    await details.locator("summary").click();
}
async function review(page: Page) {
  await button(page, "Continue to publication").click();
  await page.getByLabel("Public display name", { exact: true }).fill("Mira Builds");
  await page.getByLabel("Public profile link", { exact: true }).fill("https://example.com/mira");
  await button(page, "Review public page").click();
}
const approve = (page: Page) =>
  page
    .getByRole("checkbox", { name: "I have reviewed this project and the public contact details." })
    .check();

test("admitted project publishes after closure with explicit contact and selected links only", async ({
  page,
  baseURL,
}, info) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(baseURL!).origin) requests.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await controls(page);
  await page.getByLabel("Event closed after submission", { exact: true }).check();
  await page.getByRole("complementary").locator("summary").click();
  await button(page, "Continue to publication").click();
  await expect(page.getByLabel("Public profile link", { exact: true })).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: /Include repository link/ })).not.toBeChecked();
  await page.getByLabel("Public display name", { exact: true }).fill("Mira Builds");
  await page.getByLabel("Public profile link", { exact: true }).fill("https://example.com/mira");
  await page.getByRole("checkbox", { name: /Include project link/ }).check();
  await button(page, "Review public page").click();
  await expect(page.getByRole("status")).toContainText("can still publish");
  await expect(page.getByRole("link", { name: /Repository link/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Project link/ })).toHaveAttribute(
    "href",
    "https://example.com/offline-notes",
  );
  await expect(button(page, "Publish project")).toBeDisabled();
  await page.screenshot({
    path: `.localfiles/REQ-016/review-${info.project.name}.png`,
    fullPage: true,
  });
  await approve(page);
  await button(page, "Publish project").click();
  await expect(button(page, "Publishing…")).toBeDisabled();
  await button(page, "View public project").click();
  await expect(page.getByRole("heading", { level: 1, name: "Offline notes" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("private/offline-notes");
  await expect(page.getByRole("main")).not.toContainText("alex@example.com");
  await expect(page.getByRole("link", { name: "https://example.com/mira" })).toBeVisible();
  await page.screenshot({
    path: `.localfiles/REQ-016/public-${info.project.name}.png`,
    fullPage: true,
  });
  await button(page, "View event projects").click();
  await expect(button(page, "Offline notes")).toBeVisible();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("failed or suspended publication retains choices and never claims success", async ({
  page,
}) => {
  await open(page);
  await review(page);
  await approve(page);
  await controls(page);
  await page.getByLabel("Event suspended", { exact: true }).check();
  await button(page, "Publish project").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("suspended");
  await expect(button(page, "View public project")).toHaveCount(0);
  await page.getByLabel("Event suspended", { exact: true }).uncheck();
  await button(page, "Fail next publish (fixture)").click();
  await button(page, "Publish project").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Publication failed");
  await expect(page.getByRole("link", { name: "https://example.com/mira" })).toBeVisible();
  await button(page, "Publish project").click();
  await expect(button(page, "View public project")).toBeVisible();
});

test("stale review and session expiry require fresh review without losing private choices", async ({
  page,
}) => {
  await open(page);
  await review(page);
  await approve(page);
  await controls(page);
  await button(page, "Invalidate review (fixture)").click();
  await button(page, "Publish project").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "changed since this preview",
  );
  await expect(button(page, "Publish project")).toBeDisabled();
  await button(page, "Edit public details").click();
  await expect(page.getByLabel("Public display name", { exact: true })).toHaveValue("Mira Builds");
  await button(page, "Review public page").click();
  await expect(
    page.getByRole("heading", { name: "Offline notes — newer saved version", exact: true }),
  ).toBeVisible();
  await approve(page);
  await button(page, "Expire session (fixture)").click();
  await expect(page.getByRole("main")).not.toContainText("Mira Builds");
  await expect(button(page, "Publish project")).toHaveCount(0);
  await button(page, "Restore same identity (fixture)").click();
  await expect(page.getByRole("main")).toContainText("Mira Builds");
  await expect(button(page, "Publish project")).toBeDisabled();
});

test("private edits do not change the public snapshot and reset clears publication", async ({
  page,
}) => {
  await open(page);
  await review(page);
  await approve(page);
  await button(page, "Publish project").click();
  await button(page, "View public project").click();
  await page.getByRole("link", { name: /brag\s*\.codes/ }).click();
  await button(page, "Offline notes").click();
  await page.getByLabel("Project name", { exact: true }).fill("My private revision");
  await controls(page);
  await button(page, "View event (fixture)").click();
  await expect(button(page, "Offline notes")).toBeVisible();
  await expect(button(page, "My private revision")).toHaveCount(0);
  await button(page, "Reset publication preview").click();
  await button(page, "View event (fixture)").click();
  await expect(page.getByRole("main")).toContainText("No projects have been published yet");
});

test("required fields and safe contact validation preserve edits; long project title leads on mobile", async ({
  page,
}, info) => {
  await open(page);
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 850 });
  await page.getByLabel("Project name", { exact: true }).fill("");
  await button(page, "Continue to publication").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Add a project name");
  const title = "A long project name for keeping offline workshop notes across all of my devices";
  await page.getByLabel("Project name", { exact: true }).fill(title);
  await button(page, "My projects").click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bratislava Demo Night" })).toHaveCount(0);
  await button(page, title).focus();
  await button(page, title).press("Enter");
  await button(page, "Continue to publication").click();
  await page.getByLabel("Public display name", { exact: true }).fill("Mira");
  await page
    .getByLabel("Public profile link", { exact: true })
    .fill("https://secret@example.com/mira");
  await button(page, "Review public page").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("without credentials");
  await page.getByLabel("Public profile link", { exact: true }).fill("https://example.com/mira");
  await page.getByRole("checkbox", { name: /Include additional project details/ }).check();
  await button(page, "Review public page").click();
  await expect(page.getByRole("heading", { name: "Capabilities", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("publication recovery messages retain the selected flow and show an explicit receipt check", async ({
  page,
}) => {
  await open(page);
  await review(page);
  await controls(page);
  await button(page, "Expired review").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("review expired");
  await button(page, "Uncertain publication").click();
  await expect(page.getByRole("heading", { name: "Publication not yet confirmed." })).toBeVisible();
  await button(page, "Check publication").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("review expired");
  await button(page, "Edit public details").click();
  await expect(page.getByLabel("Public display name")).toHaveValue("Mira Builds");
});
