import { test, expect, type Page } from "@playwright/test";
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function controls(page: Page) {
  const details = page
    .getByRole("complementary", { name: "Sharing catalogue controls" })
    .locator("details");
  if (!(await details.evaluate((el) => el.hasAttribute("open"))))
    await details.locator("summary").click();
}
async function login(page: Page) {
  await button(page, "Continue with Google").click();
  await button(page, "Simulate successful sign-in").click();
}
async function open(page: Page, scenario = "empty") {
  await page.goto("./#share/home");
  await controls(page);
  await page.getByLabel("Account scenario", { exact: true }).selectOption(scenario);
}
async function share(page: Page) {
  const signedIn = await button(page, "Account menu").count();
  await button(page, "Share your work").click();
  if (!signedIn) await login(page);
}
async function paste(page: Page, url = "https://luma.com/sample-demo-night") {
  await page.getByLabel("Or paste the event link").fill(url);
  await button(page, "Find event").click();
}

test("primary Share routes through identity and links an event without creating a project", async ({
  page,
  baseURL,
}, info) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(button(page, "Share your work")).toBeVisible();
  await page.screenshot({
    path: `.localfiles/REQ-012/home-${info.project.name}.png`,
    fullPage: true,
  });
  await share(page);
  await expect(page.getByRole("heading", { name: "Scan the event QR." })).toBeVisible();
  await button(page, "Start camera").click();
  await button(page, "Simulate camera denial").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Camera access was denied");
  await paste(page);
  await expect(page.getByText("EVENT LINKED", { exact: true })).toBeVisible();
  await button(page, "Back to brag").click();
  await expect(button(page, "Share your work")).toBeVisible();
  await expect(page.getByRole("button", { name: "My projects 0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "My events 1", exact: true }).click();
  await expect(page.getByRole("article", { name: "Bratislava Demo Night" })).toHaveCount(1);
  await button(page, "Back to brag").click();
  await button(page, "Scan another event").click();
  await paste(page, "https://lu.ma/sample-demo-night");
  await expect(page.getByText("ALREADY LINKED", { exact: true })).toBeVisible();
  await button(page, "Continue to project options").click();
  for (const method of ["Type it in", "Record your pitch", "Use your AI agent"])
    await expect(page.getByRole("button", { name: new RegExp(method) })).toBeEnabled();
  await page.screenshot({
    path: `.localfiles/REQ-012/choices-${info.project.name}.png`,
    fullPage: true,
  });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("bare pasted event link reaches choices; unsafe and unknown links stay local", async ({
  page,
  baseURL,
}, info) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await share(page);
  for (const input of [
    "luma.com/blxy7j09?ticket=private",
    "user:pass@luma.com/blxy7j09",
    "luma.com/unknown-event",
  ]) {
    await paste(page, input);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("not a supported");
    await expect(page.getByLabel("Or paste the event link")).toHaveValue("");
  }
  await page.getByLabel("Or paste the event link").fill("luma.com/blxy7j09");
  await page.screenshot({
    path: `.localfiles/REQ-012/bare-link-${info.project.name}.png`,
    fullPage: true,
  });
  // Enter exercises native form validation, which previously blocked this input.
  await page.getByLabel("Or paste the event link").press("Enter");
  await expect(page.getByText("EVENT LINKED", { exact: true })).toBeVisible();
  await button(page, "Back to brag").click();
  await expect(button(page, "My events 1")).toBeVisible();
  await button(page, "Scan another event").click();
  await paste(page, " https://lu.ma/blxy7j09/ ");
  await expect(page.getByText("ALREADY LINKED", { exact: true })).toBeVisible();
  await button(page, "Continue to project options").click();
  for (const method of ["Type it in", "Record your pitch", "Use your AI agent"])
    await expect(page.getByRole("button", { name: new RegExp(method) })).toBeEnabled();
  await page.screenshot({
    path: `.localfiles/REQ-012/bare-link-choices-${info.project.name}.png`,
    fullPage: true,
  });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("one live event skips scanning; several require explicit choice and preserve separate projects", async ({
  page,
}, info) => {
  await open(page, "one");
  await share(page);
  await page.getByRole("button", { name: /Type it in/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill("My first build");
  await button(page, "Fail next save").click();
  await button(page, "Save draft").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Save failed");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("My first build");
  await button(page, "Save draft").click();
  await expect(page.getByRole("heading", { name: "Project saved.", exact: true })).toBeVisible();
  await button(page, "Share another project").click();
  await page.getByRole("button", { name: /Type it in/ }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("");
  await page.getByLabel("Project name", { exact: true }).fill("My second build");
  await button(page, "Save draft").click();
  await button(page, "View my projects").click();
  const group = page.getByRole("region", { name: "Bratislava Demo Night", exact: true });
  await expect(group.getByRole("listitem")).toHaveCount(2);
  await group.getByRole("button", { name: "My first build", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("My first build");
  await button(page, "Back to brag").click();
  await page.getByLabel("Account scenario", { exact: true }).selectOption("several");
  await button(page, "Share your work").click();
  await expect(page.getByRole("heading", { name: "Which event is this for?" })).toBeVisible();
  await page.screenshot({
    path: `.localfiles/REQ-012/choose-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("article", { name: "Prague Builders" })
    .getByRole("button", { name: "Choose this event" })
    .click();
  await expect(page.getByRole("main")).toContainText("Prague Builders");
  await expect(
    page.getByRole("heading", { name: "How would you like to share it?" }),
  ).toBeVisible();
});

test("inactive events route to linking; a close during save preserves text and rejects the upload", async ({
  page,
}) => {
  await open(page, "inactive");
  await share(page);
  await expect(page.getByRole("heading", { name: "Scan the event QR." })).toBeVisible();
  await paste(page, "https://luma.com/sample-future");
  await expect(page.getByText("Not open yet", { exact: true })).toBeVisible();
  await expect(button(page, "Continue to project options")).toHaveCount(0);
  await button(page, "Back to brag").click();
  await page.getByLabel("Account scenario", { exact: true }).selectOption("one");
  await share(page);
  await page.getByRole("button", { name: /Type it in/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Keep this text");
  // A deterministic fixture timer makes the close-during-save ordering explicit.
  await page.clock.install();
  await button(page, "Save draft").click();
  await page.getByLabel("Fixture time", { exact: true }).selectOption("2026-11-10T17:00:00Z");
  await page.clock.runFor(600);
  await expect(page.getByRole("main")).toContainText(
    "The submission window closed before this save",
  );
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Keep this text");
  await expect(button(page, "Save draft")).toBeDisabled();
  await button(page, "Back to brag").click();
  await expect(page.getByRole("button", { name: "My projects 0", exact: true })).toBeVisible();
  await button(page, "Share your work").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Keep this text");
  await expect(button(page, "Save draft")).toBeDisabled();
});

test("unknown or failed event requests create no link; exact opening and manual closure are distinct", async ({
  page,
}) => {
  await open(page);
  await share(page);
  await paste(page, "https://luma.com/sample-demo-night?ticket=fictional");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("not a supported");
  await expect(page.getByLabel("Or paste the event link")).toHaveValue("");
  await button(page, "Fail next event request").click();
  await paste(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("nothing was linked");
  await button(page, "Back to brag").click();
  await expect(page.getByRole("button", { name: "My events 0", exact: true })).toBeVisible();
  await page.getByLabel("Fixture time", { exact: true }).selectOption("2026-11-09T15:59:59Z");
  await share(page);
  await paste(page);
  await expect(button(page, "Continue to project options")).toHaveCount(0);
  await page.getByLabel("Fixture time", { exact: true }).selectOption("2026-11-09T16:00:00Z");
  await button(page, "Continue to project options").click();
  await button(page, "Close selected event (fixture)").click();
  await expect(page.getByRole("button", { name: /Type it in/ })).toBeDisabled();
});

test("voice stops into progress and review; another project follows approval, with original language", async ({
  page,
}, info) => {
  await open(page, "one");
  await share(page);
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await button(page, "Start recording").click();
  await button(page, "Simulate 30-second limit").click();
  await expect(
    page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
  ).toBeVisible();
  await expect(button(page, "Start recording")).toHaveCount(0);
  await button(page, "Back to brag").click();
  await button(page, "Share your work").click();
  await expect(button(page, "Start recording")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review your project." })).toBeVisible();
  await expect(button(page, "Use this text and edit")).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
  await expect(page.getByLabel("What problem does it solve?", { exact: true })).toHaveValue(
    "Nájsť poznámky aj bez pripojenia.",
  );
  await expect(page.getByLabel("What did you build?", { exact: true })).toHaveValue(
    "Vytvoril som zápisník s vyhľadávaním, ktorý funguje aj bez internetu.",
  );
  await expect(page.getByLabel("Project link (optional)", { exact: true })).toBeEditable();
  await expect(page.getByLabel("Repository link (optional)", { exact: true })).toBeEditable();
  await expect(
    page.getByText("Additional project details (optional)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Content language: Slovak");
  await expect(button(page, "Share another project")).toHaveCount(0);
  await page.screenshot({
    path: `.localfiles/REQ-012/prefilled-review-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("Project name", { exact: true }).fill("Moje upravené poznámky");
  await page.getByLabel("What did you build?", { exact: true }).fill("Zápisník pre náš tím.");
  await page
    .getByLabel("Project link (optional)", { exact: true })
    .fill("https://example.com/notes");
  await page
    .getByLabel("Repository link (optional)", { exact: true })
    .fill("https://github.com/example/notes");
  await button(page, "Back to brag").click();
  await expect(button(page, "My projects 0")).toBeVisible();
  await button(page, "Share your work").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Moje upravené poznámky",
  );
  await button(page, "Fail next save").click();
  await button(page, "Approve and save draft").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Save failed");
  await expect(page.getByLabel("What did you build?", { exact: true })).toHaveValue(
    "Zápisník pre náš tím.",
  );
  await expect(button(page, "Share another project")).toHaveCount(0);
  await button(page, "Approve and save draft").click();
  await button(page, "View my projects").click();
  await button(page, "Moje upravené poznámky").click();
  await expect(page.getByLabel("What did you build?", { exact: true })).toHaveValue(
    "Zápisník pre náš tím.",
  );
  await expect(page.getByLabel("Project link (optional)", { exact: true })).toHaveValue(
    "https://example.com/notes",
  );
  await expect(page.getByLabel("Repository link (optional)", { exact: true })).toHaveValue(
    "https://github.com/example/notes",
  );
  await button(page, "Back to brag").click();
  await expect(button(page, "My projects 1")).toBeVisible();
  await button(page, "Share your work").click();
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await button(page, "Start recording").click();
  await button(page, "Pause recording").click();
  await button(page, "Finish pitch").click();
  await expect(
    page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
  ).toBeVisible();
});

test("private groups survive same-identity sign-in but do not leak to another fixture identity", async ({
  page,
}, info) => {
  await open(page, "history");
  await share(page);
  await button(page, "Back to brag").click();
  await page.getByRole("button", { name: "My projects 3", exact: true }).click();
  await expect(page.getByRole("region", { name: "October Maker Meetup" })).toContainText(
    "Weekend maps",
  );
  const project = page.getByRole("listitem").filter({ has: button(page, "Weekend maps") });
  await expect(project.getByRole("heading", { level: 2, name: "Weekend maps" })).toBeVisible();
  await expect(project.locator(".tag", { hasText: "October Maker Meetup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "October Maker Meetup" })).toHaveCount(0);
  await button(page, "Weekend maps").focus();
  await expect(button(page, "Weekend maps")).toBeFocused();
  await page.screenshot({
    path: `.localfiles/REQ-012/projects-${info.project.name}.png`,
    fullPage: true,
  });
  await button(page, "Expire session (fixture)").click();
  await expect(button(page, "Weekend maps")).toHaveCount(0);
  await login(page);
  await expect(button(page, "Weekend maps")).toBeVisible();
  await button(page, "Weekend maps").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Weekend maps");
  // The owner explicitly retained editing of saved projects after closure.
  await expect(page.getByLabel("Project name", { exact: true })).toBeEditable();
  await expect(button(page, "Save draft")).toBeEnabled();
  await page.getByLabel("Sample identity", { exact: true }).selectOption("sam");
  await share(page);
  await expect(page.getByRole("heading", { name: "Scan the event QR." })).toBeVisible();
  await button(page, "Back to brag").click();
  await expect(page.getByRole("button", { name: "My projects 0", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "My events 0", exact: true })).toBeVisible();
});

test("session expiry retains unsaved fields and uploaded agent proposal uses the same editor", async ({
  page,
}) => {
  await open(page, "one");
  await share(page);
  await page.getByRole("button", { name: /Use your AI agent/ }).click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).toHaveValue(
    /UPLOAD_TOKEN DEMO-UPLOAD-/,
  );
  await page.getByLabel("Pitch language", { exact: true }).selectOption("en");
  await button(page, "Simulate proposal upload").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Offline notes");
  await expect(button(page, "Use this text and edit")).toHaveCount(0);
  await page.getByLabel("Project name", { exact: true }).fill("Retain my edits");
  await button(page, "Expire session (fixture)").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
  await login(page);
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Retain my edits");
  await button(page, "Approve and save draft").click();
  await button(page, "View my projects").click();
  await expect(button(page, "Retain my edits")).toBeVisible();
});

test("catalogue navigation, keyboard focus and narrow layout remain usable", async ({
  page,
}, info) => {
  await page.goto("./#catalogue");
  await button(page, "Open Share your work preview").click();
  await expect(button(page, "Share your work")).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
  await button(page, "Slop Gallery").click();
  await expect(page.getByRole("heading", { name: "Slop Gallery", exact: true })).toBeVisible();
  await button(page, "Back to brag").click();
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await controls(page);
  await page.getByLabel("Account scenario", { exact: true }).selectOption("history");
  await button(page, "Sign in").click();
  await login(page);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(button(page, "Account menu")).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("linking another event cannot move an unfinished project and closed recordings are held", async ({
  page,
}) => {
  await open(page, "one");
  await share(page);
  await page.getByRole("button", { name: /Type it in/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Stay in Bratislava");
  await button(page, "Back to brag").click();
  await button(page, "Scan another event").click();
  await paste(page, "https://luma.com/sample-builders");
  await expect(page.getByRole("heading", { name: "Prague Builders" })).toBeVisible();
  await button(page, "Resume unfinished project").click();
  await expect(page.getByRole("main")).toContainText("Bratislava Demo Night");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Stay in Bratislava");
  await button(page, "Save draft").click();
  await button(page, "View my projects").click();
  await expect(page.getByRole("region", { name: "Bratislava Demo Night" })).toContainText(
    "Stay in Bratislava",
  );
  await expect(page.getByRole("region", { name: "Prague Builders" })).toHaveCount(0);
  await page.getByLabel("Account scenario", { exact: true }).selectOption("one");
  await share(page);
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await button(page, "Start recording").click();
  await button(page, "Close selected event (fixture)").click();
  await button(page, "Pause recording").click();
  await button(page, "Finish pitch").click();
  await expect(page.getByRole("heading", { name: "Recording retained." })).toBeVisible();
  await expect(button(page, "Process retained recording")).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
  ).toHaveCount(0);
});
