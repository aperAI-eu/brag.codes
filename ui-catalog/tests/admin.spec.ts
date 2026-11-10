import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByRole("button", { name: "Simulate successful sign-in", exact: true }).click();
}
async function admin(page: Page) {
  await page.goto("./#access/home");
  await page.getByLabel("Sample user", { exact: true }).selectOption("jan");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await signIn(page);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Account", exact: true })
    .getByRole("button", { name: "Admin", exact: true })
    .click();
}
async function scan(page: Page) {
  await page.getByRole("button", { name: "Scan and add event", exact: true }).click();
  await page.getByRole("button", { name: "Simulate QR scan", exact: true }).click();
}
async function fits(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
}

test("mobile admin path connects menu, scan, window review, confirmation and event list", async ({
  page,
  baseURL,
}, testInfo) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error("Catalogue must not open a camera");
    };
  });
  await admin(page);
  await page.screenshot({
    path: `.localfiles/screenshots/admin-events-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Scan and add event", exact: true }).click();
  await expect(page.getByText("Camera preview (simulated)", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/admin-scan-${testInfo.project.name}.png`,
    fullPage: true,
  });
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 800 });
  await fits(page);
  await page.getByRole("button", { name: "Simulate QR scan", exact: true }).click();
  await expect(page.getByLabel("Event starts", { exact: true })).toHaveValue("2026-11-12T18:00");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-11-12T17:00");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-11-13T18:00");
  await fits(page);
  await page.screenshot({
    path: `.localfiles/screenshots/admin-review-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Event whitelisted.", exact: true }),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({
    path: `.localfiles/screenshots/admin-confirmed-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open contribution page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Example demo night", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Use your AI agent", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to events", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Manage Example demo night", exact: true }),
  ).toBeVisible();
  await fits(page);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("submission defaults follow start independently, invalid windows fail and saved bounds stay fixed", async ({
  page,
}) => {
  await admin(page);
  await scan(page);
  await page.getByLabel("Event starts", { exact: true }).fill("2026-11-14T18:00");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-11-14T17:00");
  await page.getByLabel("From", { exact: true }).fill("2026-11-14T16:00");
  await page.getByLabel("Event starts", { exact: true }).fill("2026-11-15T19:00");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-11-14T16:00");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-11-16T19:00");
  await page.getByLabel("To", { exact: true }).fill("2026-11-14T16:00");
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await expect(page.getByText("To must be later than From.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("From", { exact: true }).fill("");
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await expect(page.getByText("Choose a date and time.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset window to defaults", exact: true }).click();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-11-15T18:00");
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await page.getByRole("button", { name: "Back to events", exact: true }).click();
  await page.getByRole("button", { name: "Manage Example demo night", exact: true }).click();
  await page.getByLabel("Event starts", { exact: true }).fill("2026-11-16T19:00");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-11-15T18:00");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-11-16T19:00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Event updated.", exact: true })).toBeVisible();
});

test("camera denial permits paste, unsafe links stay local and repeat QR opens the existing event", async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  await admin(page);
  await page.getByRole("button", { name: "Scan and add event", exact: true }).click();
  await page.getByRole("button", { name: "Simulate camera denial", exact: true }).click();
  await expect(page.getByText("Camera access denied", { exact: true })).toBeVisible();
  for (const url of [
    "javascript:alert(1)",
    "https://example.com/ticket",
    "https://luma.com/example-demo-night?ticket=secret",
  ]) {
    await page.getByLabel("Event link", { exact: true }).fill(url);
    await page.getByRole("button", { name: "Review event link", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("example event links");
    await expect(page.getByLabel("Event link", { exact: true })).toHaveValue(url);
  }
  await page.getByLabel("Event link", { exact: true }).fill("https://lu.ma/example-builders");
  await page.getByRole("button", { name: "Review event link", exact: true }).click();
  await expect(page.getByText("Already whitelisted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open existing event", exact: true }).click();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue(
    "Example builders meetup",
  );
  await page.getByRole("button", { name: "Back to events", exact: true }).click();
  await page.getByRole("button", { name: "Scan and add event", exact: true }).click();
  await page.getByRole("button", { name: "Retry camera (fixture)", exact: true }).click();
  await page.getByRole("button", { name: "Simulate QR scan", exact: true }).click();
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await page.getByRole("button", { name: "Back to events", exact: true }).click();
  await scan(page);
  await expect(page.getByText("Already whitelisted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to events", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(external).toEqual([]);
});

test("expiry hides a review, same-user reauthentication resumes it and sign-out clears it", async ({
  page,
}) => {
  await admin(page);
  await scan(page);
  await page.getByLabel("Event title", { exact: true }).fill("Unsaved mobile event");
  await page.getByRole("button", { name: "Expire session (fixture)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to brag.", exact: true })).toBeVisible();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
  await signIn(page);
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Unsaved mobile event");
  await page.getByRole("button", { name: "Revoke admin role (fixture)", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Admin access unavailable.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Whitelist event", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Assign admin role (fixture)", exact: true }).click();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Account", exact: true })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await page.evaluate(() => {
    window.location.hash = "access/admin/review";
  });
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Start from your events.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to events", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("all mobile admin routes require a session and an independent role", async ({ page }) => {
  await page.goto("./#access/admin/review");
  await signIn(page);
  for (const route of ["review", "scan", "existing", "confirmed", "contribution"]) {
    await page.evaluate((route) => {
      window.location.hash = `access/admin/${route}`;
    }, route);
    await expect(
      page.getByRole("heading", { name: "Admin access unavailable.", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Whitelist event", exact: true })).toHaveCount(0);
    await expect(page.getByText("Example demo night", { exact: true })).toHaveCount(0);
  }
});

test("window defaults use elapsed hours across DST and reject nonexistent or ambiguous local times", async ({
  page,
}) => {
  await admin(page);
  await scan(page);
  await page.getByLabel("Event starts", { exact: true }).fill("2027-03-27T18:00");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2027-03-27T17:00");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2027-03-28T19:00");
  await page.getByLabel("Event starts", { exact: true }).fill("2027-03-28T02:30");
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await expect(page.locator("#admin-starts-error")).toContainText("does not exist");
  await page.getByLabel("Event starts", { exact: true }).fill("2027-10-31T02:30");
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await expect(page.locator("#admin-starts-error")).toContainText("occurs twice");
  await page.getByLabel("Event time zone", { exact: true }).selectOption("UTC");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2027-10-31T01:30");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2027-11-01T02:30");
  await page.getByRole("button", { name: "Whitelist event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Event whitelisted.", exact: true }),
  ).toBeVisible();
});
