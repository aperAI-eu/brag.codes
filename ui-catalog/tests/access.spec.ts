import { test, expect, type Page } from "@playwright/test";

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  return page.getByRole("navigation", { name: "Account", exact: true });
}

async function completeSignIn(page: Page, provider = "Google") {
  await page.getByRole("button", { name: `Continue with ${provider}`, exact: true }).click();
  await page.getByRole("button", { name: "Simulate successful sign-in", exact: true }).click();
}

test("login keeps Admin hidden until an independent role is assigned; revocation removes access", async ({
  page,
  baseURL,
}, testInfo) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./#access/home");
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await completeSignIn(page);
  let menu = await openMenu(page);
  await expect(menu.getByText("Alex Builder", { exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `.localfiles/screenshots/login-member-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Assign admin role (fixture)", exact: true }).click();
  menu = await openMenu(page);
  await expect(menu.getByText("Alex Builder", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/login-admin-menu-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await menu.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
  await expect(page.getByText("Example builders meetup", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revoke admin role (fixture)", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Admin access unavailable.", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Example builders meetup", { exact: true })).toHaveCount(0);
  menu = await openMenu(page);
  await expect(menu.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goBack();
  await expect(page.getByText("Example builders meetup", { exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("direct admin navigation uses common sign-in and denies a member after callback", async ({
  page,
}) => {
  await page.goto("./#access/admin");
  await expect(page.getByRole("heading", { name: "Sign in to brag.", exact: true })).toBeVisible();
  await completeSignIn(page, "GitHub");
  await expect(
    page.getByRole("heading", { name: "Admin access unavailable.", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Example builders meetup", { exact: true })).toHaveCount(0);
});

test("all provider and email fixtures retain the user role and sign-in returns home", async ({
  page,
}) => {
  await page.goto("./#access/home");
  await page.getByLabel("Sample user", { exact: true }).selectOption("jan");
  for (const provider of ["Google", "Microsoft", "GitHub", "email"]) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await completeSignIn(page, provider);
    await expect(page.getByRole("button", { name: "Scan event QR", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Events", exact: true })).toHaveCount(0);
    const menu = await openMenu(page);
    await expect(menu.getByRole("button", { name: "Admin", exact: true })).toBeVisible();
    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
  }
});

test("cancel, provider error and session expiry preserve a safe admin continuation", async ({
  page,
}) => {
  await page.goto("./#access/home");
  await page.getByLabel("Sample user", { exact: true }).selectOption("jan");
  await page.evaluate(() => {
    window.location.hash = "access/admin";
  });
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("cancelled");
  await page.getByRole("button", { name: "Continue with Microsoft", exact: true }).click();
  await page.getByRole("button", { name: "Simulate sign-in error", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable");
  await completeSignIn(page, "Google");
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expire session (fixture)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to brag.", exact: true })).toBeVisible();
  await expect(page.getByText("Example builders meetup", { exact: true })).toHaveCount(0);
  await completeSignIn(page, "GitHub");
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
});

test("login catalogue fits narrow screens and expired handoffs never authenticate", async ({
  page,
}, testInfo) => {
  await page.goto("./#access/provider");
  await expect(
    page.getByRole("heading", { name: "This sign-in attempt has expired.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Account menu", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `.localfiles/screenshots/login-choice-${testInfo.project.name}.png`,
    fullPage: true,
  });
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "Back to brag", exact: true }).click();
  await expect(page.getByRole("button", { name: "Scan event QR", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("admin integrations preview hides credentials after save and removes access on role revocation", async ({
  page,
}) => {
  await page.goto("./#access/home");
  await page.getByLabel("Sample user", { exact: true }).selectOption("jan");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await completeSignIn(page);
  const menu = await openMenu(page);
  await menu.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("link", { name: "API setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pitch integrations" })).toBeVisible();
  const token = page.getByLabel("Distill service token", { exact: false });
  await token.fill("fictional-distill-token");
  await page.getByLabel("Anthropic API key", { exact: false }).fill("fictional-anthropic-key");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(token).toHaveValue("");
  await expect(page.getByText("Distill service token · Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revoke admin role (fixture)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pitch integrations" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Admin access unavailable.", exact: true }),
  ).toBeVisible();
});

test("separate project drafts share the structured editor after ordinary login", async ({
  page,
}) => {
  await page.goto("./#access/submit");
  await completeSignIn(page);
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await page.getByRole("button", { name: "Start recording preview" }).click();
  await page.getByRole("button", { name: "Simulate 20-second limit" }).click();
  await expect(
    page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and start another project" })).toBeDisabled();
  await page.getByRole("button", { name: "Use this text and edit" }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Offline notes");
  await page.getByText("Additional project details (optional)", { exact: true }).click();
  await expect(page.getByLabel("Core idea", { exact: true })).toHaveValue(
    "Keep a searchable notebook on the device",
  );
  await expect(page.getByRole("button", { name: "Save and start another project" })).toBeDisabled();
  await page.getByRole("button", { name: "Approve and save draft" }).click();
  await page.getByRole("button", { name: "Save and start another project" }).click();
  await page.getByRole("button", { name: /Type it in/ }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("");
  await page.getByLabel("Project name", { exact: true }).fill("Another project");
  await page.getByRole("button", { name: "Save and start another project" }).click();
  const list = page.getByRole("region", { name: "Your private drafts" });
  await expect(list.getByRole("button", { name: "Another project", exact: true })).toBeVisible();
  await list.getByRole("button", { name: "Offline notes", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Offline notes");
});

test("homepage login, shared scanner fallback and three capture choices form one journey", async ({
  page,
}) => {
  await page.goto("./#access/home");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await completeSignIn(page);
  await page.getByRole("button", { name: "Scan event QR", exact: true }).click();
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await page.getByRole("button", { name: "Simulate camera denial", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Camera access was denied");
  await page.getByLabel("Or paste the event link").fill("luma.com/sample-event");
  await page.getByRole("button", { name: "Find event", exact: true }).click();
  for (const name of ["Type it in", "Record your pitch", "Use your AI agent"])
    await expect(page.getByRole("button", { name: new RegExp(name) })).toBeEnabled();
});

test("GitHub configuration, pending and recovery states reuse the shared sign-in", async ({
  page,
}, testInfo) => {
  await page.goto("./#access/sign-in");
  const mode = page.getByLabel("Provider configuration", { exact: true });
  await mode.selectOption("unavailable");
  await expect(
    page.getByRole("button", { name: "Continue with GitHub · Coming soon", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeEnabled();
  await mode.selectOption("pending");
  await expect(
    page.getByRole("button", { name: "Continue with GitHub", exact: true }),
  ).toBeDisabled();
  await mode.selectOption("github");
  const github = page.getByRole("button", { name: "Continue with GitHub", exact: true });
  await github.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("cancelled");
  await github.click();
  await page.getByRole("button", { name: "Simulate sign-in error", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable");
  await github.click();
  await page.getByRole("button", { name: "Simulate no verified email", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Verify an email on GitHub",
  );
  await page.screenshot({
    path: `.localfiles/screenshots/req018-email-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await github.click();
  await page.getByRole("button", { name: "Simulate existing Google account", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Sign in with its existing method",
  );
  await expect(page.getByRole("button", { name: /link.*account/i })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: `.localfiles/screenshots/req018-collision-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await completeSignIn(page, "Google");
  const menu = await openMenu(page);
  await expect(menu.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
});
