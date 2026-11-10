import { test, expect, type Page } from "@playwright/test";
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function scan(page: Page) {
  await page.goto("./#mobile");
  await button(page, "Open admin events").click();
  await button(page, "Scan and add event").click();
}
async function review(page: Page) {
  await scan(page);
  await page.getByLabel("Or paste the event link").fill("luma.com/example-demo-night");
  await button(page, "Review event link").click();
  await expect(page.getByRole("heading", { name: "Review your event." })).toBeVisible();
}

test("optional help preserves primary homepage actions and supports keyboard cancellation", async ({
  page,
  baseURL,
}, info) => {
  const errors: string[] = [],
    outside: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) outside.push(request.url());
  });
  await page.goto("./#mobile");
  await expect(button(page, "Share your work")).toBeVisible();
  await expect(button(page, "Slop Gallery")).toBeVisible();
  await button(page, "Install / app help").focus();
  await page.keyboard.press("Enter");
  await button(page, "Install brag").click();
  await expect(button(page, "Waiting for browser…")).toBeDisabled();
  await button(page, "Cancel installation").click();
  await expect(
    page.getByText("Installation cancelled. You can keep using brag in this browser."),
  ).toBeVisible();
  await expect(button(page, "Install brag")).toHaveCount(0);
  await page.screenshot({
    path: `.localfiles/screenshots/mobile-help-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button(page, "Continue where I was").click();
  await expect(button(page, "Share your work")).toBeVisible();
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test("install outcomes, unavailable prompt and standalone never block browser use", async ({
  page,
}) => {
  await page.goto("./#mobile");
  await button(page, "Install / app help").click();
  await button(page, "Install brag").click();
  await button(page, "Accept installation").click();
  await expect(page.getByText(/Your browser accepted the install request/)).toBeVisible();
  await expect(button(page, "Install brag")).toHaveCount(0);
  await button(page, "Reset mobile preview").click();
  await button(page, "Install / app help").click();
  await button(page, "Install brag").click();
  await button(page, "Prompt fails").click();
  await expect(page.locator("main").getByRole("alert")).toContainText("couldn’t open");
  await button(page, "No install prompt").click();
  await expect(page.getByRole("heading", { name: "iPhone or iPad" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Android or computer" })).toBeVisible();
  await expect(button(page, "Install brag")).toHaveCount(0);
  await button(page, "Already in app").click();
  await expect(page.getByText(/You’re using the app/)).toBeVisible();
  await expect(button(page, "Install brag")).toHaveCount(0);
});

test("offline launch has no identity and reconnect never submits automatically", async ({
  page,
}, info) => {
  await page.goto("./#mobile");
  await button(page, "Offline launch").click();
  await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
  await expect(page.getByText("Jan Demo", { exact: true })).toHaveCount(0);
  await button(page, "Try again").click();
  await expect(page.getByText(/Still unable to connect/)).toBeVisible();
  await button(page, "Reconnect").click();
  await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/mobile-offline-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button(page, "Try again").click();
  await expect(button(page, "Share your work")).toBeVisible();
});

test("admin explicitly starts camera and reviews before whitelisting", async ({ page }, info) => {
  await scan(page);
  await expect(page.getByLabel("Event QR camera preview")).toBeHidden();
  await button(page, "Start camera").click();
  await expect(page.getByText("Waiting for camera permission…")).toBeVisible();
  await button(page, "Allow camera").click();
  await expect(page.getByLabel("Event QR camera preview")).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/mobile-camera-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button(page, "Decode new event QR").click();
  await expect(page.getByText("Loading event details for your review…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review your event." })).toBeVisible();
  await page.getByLabel("Event title", { exact: true }).fill("Reviewed mobile event");
  await button(page, "Whitelist event").click();
  await expect(page.getByRole("heading", { name: "Event whitelisted." })).toBeVisible();
  await button(page, "Back to events").click();
  await expect(page.getByText("Reviewed mobile event", { exact: true })).toBeVisible();
});

test("duplicate and denied camera go through existing review without duplicate entries", async ({
  page,
}) => {
  await scan(page);
  await button(page, "Deny camera").click();
  await expect(page.locator("main").getByRole("alert")).toContainText("denied");
  await button(page, "Camera unavailable").click();
  await expect(page.locator("main").getByRole("alert")).toContainText("unavailable or busy");
  await page.getByLabel("Or paste the event link").fill("lu.ma/example-builders");
  await button(page, "Review event link").click();
  await expect(page.getByRole("heading", { name: "This event is already here." })).toBeVisible();
  await button(page, "Open existing event").click();
  await expect(page.getByRole("heading", { name: "Edit event." })).toBeVisible();
});

test("unsafe QR clears tokens, offline safe input survives and unknown fixtures never fetch", async ({
  page,
}) => {
  await scan(page);
  const external: string[] = [];
  page.on("request", (request) => external.push(request.url()));
  await button(page, "Decode ticket QR").click();
  await expect(page.getByLabel("Or paste the event link")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText("fictional-private-token");
  await button(page, "Lose connection").click();
  await page.getByLabel("Or paste the event link").fill("luma.com/example-demo-night");
  await button(page, "Review event link").click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Nothing was whitelisted");
  await expect(page.getByLabel("Or paste the event link")).toHaveValue(
    "https://luma.com/example-demo-night",
  );
  await button(page, "Restore connection").click();
  await page.getByLabel("Or paste the event link").fill("luma.com/unknown-event");
  await button(page, "Review event link").click();
  await expect(page.locator("main").getByRole("alert")).toContainText("two fictional events");
  expect(external).toEqual([]);
});

test("background, help and cancellation stop scanning and ignore pending results", async ({
  page,
}) => {
  await scan(page);
  await button(page, "Start camera").click();
  await button(page, "Background app").click();
  await expect(page.getByLabel("Event QR camera preview")).toBeHidden();
  await expect(button(page, "Allow camera")).toBeDisabled();
  await button(page, "Start camera").click();
  await button(page, "Install / app help").click();
  await button(page, "Continue where I was").click();
  await expect(page.getByLabel("Event QR camera preview")).toBeHidden();
  await button(page, "Start camera").click();
  await button(page, "Allow camera").click();
  await button(page, "Decode new event QR").click();
  await button(page, "Back to events").click();
  await expect(button(page, "Scan and add event")).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByRole("heading", { name: "Review your event." })).toHaveCount(0);
});

test("help and same-account recovery retain review, other account clears it", async ({
  page,
}, info) => {
  await review(page);
  await page.getByLabel("Event title", { exact: true }).fill("My unsaved mobile event");
  await button(page, "Install / app help").click();
  await button(page, "Continue where I was").click();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue(
    "My unsaved mobile event",
  );
  await button(page, "Session expires").click();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("My unsaved mobile event");
  await button(page, "Return as same admin (fixture)").click();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue(
    "My unsaved mobile event",
  );
  await page.screenshot({
    path: `.localfiles/screenshots/mobile-review-${info.project.name}.png`,
    fullPage: true,
  });
  await button(page, "Different account / role revoked").click();
  await expect(page.getByRole("heading", { name: "Admin access unavailable." })).toBeVisible();
  await button(page, "Sign in").click();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("There is no active review on this screen.", { exact: false }),
  ).toBeVisible();
});
