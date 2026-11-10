import { test, expect, type Page, type TestInfo } from "@playwright/test";

const browserIssues = new WeakMap<Page, string[]>();
test.beforeEach(({ page, baseURL }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin)
      issues.push(`External request: ${request.url()}`);
  });
});
test.afterEach(({ page }) => {
  expect(browserIssues.get(page)).toEqual([]);
});

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const title = (page: Page) => page.getByLabel("Project name", { exact: true });
async function open(page: Page, scenario = "unfinished", share = true) {
  await page.goto("./#share/home");
  await page.getByText("Preview scenarios and simulations", { exact: true }).click();
  await page.getByLabel("Account scenario", { exact: true }).selectOption(scenario);
  await button(page, share ? "Share your work" : "Sign in").click();
  await button(page, "Continue with Google").click();
  await button(page, "Simulate successful sign-in").click();
}
async function shot(page: Page, info: TestInfo, name: string) {
  const summary = page.getByText("Preview scenarios and simulations", { exact: true });
  await summary.click();
  await page.getByRole("main").scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: `.localfiles/REQ-012-T007/${name}-${info.project.name}.png`,
    fullPage: true,
  });
  await summary.click();
}
async function typeProject(page: Page) {
  await open(page, "one");
  await page.getByRole("button", { name: /Type it in/ }).click();
  await title(page).fill("Keep my work");
}

test("choose an exact unfinished project across devices or start independent work", async ({
  page,
}, info) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Pick up where you left off." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(4);
  await shot(page, info, "unfinished-chooser");
  await button(page, "Resume Phone garden pitch").focus();
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveValue("Phone garden pitch");
  await expect(page.getByRole("main")).toContainText("Bratislava Demo Night");
  await title(page).fill("Local garden correction");
  await button(page, "Back to brag").click();
  await button(page, "Resume unfinished project").click();
  await expect(title(page)).toHaveValue("Local garden correction");
  await button(page, "Approve and save draft").click();
  await button(page, "Share another project").click();
  await expect(button(page, "Resume Phone garden pitch")).toHaveCount(0);
  await button(page, "Start a separate project").click();
  await page
    .getByRole("article", { name: "Prague Builders", exact: true })
    .getByRole("button", { name: "Choose this event" })
    .click();
  await page.getByRole("button", { name: /Type it in/ }).click();
  await expect(title(page)).toHaveValue("");
  await title(page).fill("A separate build");
  await button(page, "Save draft").click();
  await button(page, "View my projects").click();
  await expect(button(page, "Local garden correction")).toBeVisible();
  await expect(button(page, "Agent walking maps")).toBeVisible();
  await expect(page.getByRole("region", { name: "Prague Builders", exact: true })).toContainText(
    "A separate build",
  );
});

test("history filters overlap saved pending work without double counting and label legacy drafts", async ({
  page,
}, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 850 });
  await open(page, "unfinished", false);
  await button(page, "My projects 5").click();
  await expect(page.getByRole("listitem")).toHaveCount(5);
  await expect(button(page, "Saved 2")).toBeVisible();
  await expect(button(page, "Unfinished 4")).toBeVisible();
  await shot(page, info, "history-states");
  await button(page, "Saved 2").click();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("main")).toContainText("Existing draft");
  await expect(button(page, "Saved notes, new pitch")).toBeVisible();
  await button(page, "Unfinished 4").click();
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await expect(button(page, "Saved notes, new pitch")).toBeVisible();
  await expect(button(page, "Existing trail guide")).toHaveCount(0);
  await button(page, "All 5").click();
  await expect(button(page, "Saved notes, new pitch")).toHaveCount(1);
});

test("one proposal replaces pairing and duplicate uploads preserve owner edits", async ({
  page,
}, info) => {
  await open(page, "one");
  await page.getByRole("button", { name: /Use your AI agent/ }).click();
  await expect(page.getByRole("main")).toContainText("Waiting for your agent’s proposal");
  await expect(button(page, "Approve this agent")).toHaveCount(0);
  await shot(page, info, "agent-proposal-waiting");
  await button(page, "Simulate proposal upload").click();
  await title(page).fill("My reviewed proposal");
  await button(page, "Simulate duplicate upload").click();
  await expect(title(page)).toHaveValue("My reviewed proposal");
  await expect(page.getByRole("main")).toContainText("already received");
  await expect(button(page, "Simulate proposal upload")).toBeDisabled();
  await shot(page, info, "agent-proposal-review");
});

test("a pitch admitted just before close can finish processing and be approved afterward", async ({
  page,
}, info) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await open(page, "one");
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await button(page, "Start recording").click();
  await button(page, "Simulate 30-second limit").click();
  await button(page, "Close selected event (fixture)").click();
  await page.clock.runFor(750);
  await expect(
    page.getByRole("heading", { name: "Claude is preparing your template…" }),
  ).toBeVisible();
  await page.clock.runFor(750);
  await expect(title(page)).toBeEditable();
  await expect(button(page, "Approve and save draft")).toBeEnabled();
  await expect(page.getByRole("main")).toContainText("Received during the submission window");
  await shot(page, info, "late-pitch-review");
  await title(page).fill("Late but received");
  await button(page, "Approve and save draft").click();
  await page.clock.runFor(500);
  await expect(page.getByRole("heading", { name: "Project saved.", exact: true })).toBeVisible();
  await button(page, "Share another project").click();
  await expect(page.getByRole("heading", { name: "Scan the event QR." })).toBeVisible();
});

test("received agent work and saved or legacy form edits remain allowed after closing", async ({
  page,
}, info) => {
  await open(page);
  await button(page, "Resume Agent walking maps").click();
  await expect(page.getByRole("main")).toContainText("Submissions are closed");
  await expect(button(page, "Approve and save draft")).toBeEnabled();
  await title(page).fill("Walking maps reviewed");
  await button(page, "Approve and save draft").click();
  await button(page, "View my projects").click();
  await button(page, "Walking maps reviewed").click();
  await expect(title(page)).toBeEditable();
  await title(page).fill("Walking maps edited later");
  await button(page, "Save draft").click();
  await button(page, "View my projects").click();
  await button(page, "Existing trail guide").click();
  await expect(page.getByRole("heading", { name: "Your existing draft." })).toBeVisible();
  await expect(title(page)).toBeEditable();
  await expect(button(page, "Save draft")).toBeEnabled();
  await expect(page.getByRole("button", { name: /Use your AI agent/ })).toHaveCount(0);
  await shot(page, info, "closed-existing-editor");
  await title(page).fill("Legacy guide corrected");
  await button(page, "Save draft").click();
  await button(page, "View my projects").click();
  await expect(button(page, "Legacy guide corrected")).toBeVisible();
});

test("suspension racing a saved edit preserves dirty text but makes the form read only", async ({
  page,
}, info) => {
  await open(page, "history", false);
  await button(page, "My projects 3").click();
  await button(page, "Weekend maps").click();
  await title(page).fill("Keep my unsaved route");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await button(page, "Save draft").click();
  await button(page, "Suspend selected event (fixture)").click();
  await page.clock.runFor(500);
  await expect(title(page)).toHaveValue("Keep my unsaved route");
  await expect(title(page)).toBeDisabled();
  await expect(page.getByRole("main")).toContainText("suspended before this save");
  await expect(button(page, "Save draft")).toHaveCount(0);
  await shot(page, info, "suspended-editor");
  await button(page, "Back to my projects").click();
  await expect(button(page, "Weekend maps")).toBeVisible();
  await expect(button(page, "Keep my unsaved route")).toHaveCount(0);
});

test("failed post-close pitch keeps its transcript but cannot retry or become a first typed save", async ({
  page,
}, info) => {
  await open(page);
  await button(page, "Resume Unfinished workshop pitch").click();
  await expect(page.getByRole("main")).toContainText("workshop booking tool");
  await expect(button(page, "Retry processing")).toBeDisabled();
  await expect(button(page, "Save draft")).toHaveCount(0);
  await expect(button(page, "Approve and save draft")).toHaveCount(0);
  await shot(page, info, "failed-closed-pitch");
  page.once("dialog", (dialog) => dialog.dismiss());
  await button(page, "Discard unfinished project").click();
  await expect(page.getByRole("heading", { name: "Your pitch needs attention." })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await button(page, "Discard unfinished project").click();
  await expect(button(page, "Unfinished workshop pitch")).toHaveCount(0);
  await expect(button(page, "All 4")).toBeVisible();
});

test("a rejected late agent write cannot alter the owner's saved fields", async ({
  page,
}, info) => {
  await open(page, "one");
  await page.getByRole("button", { name: /Use your AI agent/ }).click();
  await button(page, "Simulate proposal upload").click();
  await title(page).fill("My approved version");
  await button(page, "Approve and save draft").click();
  await button(page, "View my projects").click();
  await button(page, "My approved version").click();
  await button(page, "Simulate stale agent write").click();
  await expect(title(page)).toHaveValue("My approved version");
  await expect(page.getByRole("main")).toContainText("saved fields were not changed");
  await expect(page.getByRole("button", { name: /Use your AI agent/ })).toHaveCount(0);
  await shot(page, info, "saved-agent-protection");
});

test("upgrade refusal preserves text, requires recovery before reload and does not claim a save", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    }),
  );
  await typeProject(page);
  await button(page, "Simulate upgrade required").click();
  await expect(page.getByLabel("Your unsaved text")).toHaveValue(/Project name: Keep my work/);
  await expect(page.getByLabel("Your unsaved text")).not.toHaveValue(/schema_version/);
  await expect(button(page, "Reload updated app")).toBeDisabled();
  await page.evaluate(() => {
    location.hash = "#share/submit";
  });
  await expect(page.getByRole("heading", { name: "A newer version is needed." })).toBeVisible();
  await button(page, "Copy unsaved text").click();
  await expect(button(page, "Reload updated app")).toBeDisabled();
  await expect(page.getByRole("main")).toContainText("This change was not saved");
  await shot(page, info, "upgrade-text-recovery");
  await page.getByRole("checkbox", { name: "I have kept a copy of this text" }).focus();
  await page.keyboard.press("Space");
  await expect(button(page, "Reload updated app")).toBeEnabled();
  await button(page, "Reload updated app").click();
  await expect(button(page, "My projects 0")).toBeVisible();
});

test("upgrade with retained audio needs explicit discard even after copying text", async ({
  page,
}, info) => {
  await open(page, "one");
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await button(page, "Start recording").click();
  await button(page, "Simulate upgrade required").click();
  await expect(page.getByRole("main")).toContainText("Copying text does not preserve audio");
  await page.getByRole("checkbox", { name: "I have kept a copy of this text" }).check();
  await expect(button(page, "Reload updated app")).toBeDisabled();
  await shot(page, info, "upgrade-audio-recovery");
  page.once("dialog", (dialog) => dialog.dismiss());
  await button(page, "Discard unsaved work").click();
  await expect(button(page, "Reload updated app")).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await button(page, "Discard unsaved work").click();
  await expect(button(page, "Reload updated app")).toBeEnabled();
  await button(page, "Reload updated app").click();
  await expect(button(page, "My projects 0")).toBeVisible();
});

test("blocked reauthentication hides private fields, resumes the same account and clears them for another", async ({
  page,
}, info) => {
  await typeProject(page);
  await button(page, "Simulate blocked sign-in window").click();
  await expect(title(page)).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("Keep my work");
  await button(page, "Open sign-in window").click();
  await expect(page.getByRole("main")).toContainText("Open brag in a separate tab");
  await button(page, "I’m signed in — check again").click();
  await expect(page.getByRole("main")).toContainText("still signed out");
  await shot(page, info, "blocked-sign-in");
  await button(page, "Sign in as same account in other tab (fixture)").click();
  await button(page, "I’m signed in — check again").click();
  await expect(title(page)).toHaveValue("Keep my work");
  await button(page, "Simulate blocked sign-in window").click();
  await button(page, "Sign in as other account in other tab (fixture)").click();
  await button(page, "I’m signed in — check again").click();
  await expect(button(page, "My projects 0")).toBeVisible();
  await expect(button(page, "Resume unfinished project")).toHaveCount(0);
  await button(page, "Share your work").click();
  await expect(page.getByRole("heading", { name: "Scan the event QR." })).toBeVisible();
  await expect(title(page)).toHaveCount(0);
});

test("failing a new pitch on a saved project after closure leaves the saved version editable", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await open(page);
  await button(page, "Resume Saved notes, new pitch").click();
  await button(page, "Close selected event (fixture)").click();
  await button(page, "Fail pitch processing").click();
  await expect(title(page)).toHaveValue("Saved notes, new pitch");
  await expect(title(page)).toBeEditable();
  await expect(button(page, "Save draft")).toBeEnabled();
  await expect(page.getByRole("main")).toContainText("saved version is unchanged");
  await button(page, "Back to brag").click();
  await button(page, "My projects 5").click();
  await expect(button(page, "Unfinished 3")).toBeVisible();
  await button(page, "Saved 2").click();
  await expect(button(page, "Saved notes, new pitch")).toBeVisible();
});

test("expired instructions without a proposal cannot enable post-close completion", async ({
  page,
}) => {
  await open(page, "one");
  await page.getByRole("button", { name: /Use your AI agent/ }).click();
  await button(page, "Expire upload instructions").click();
  await button(page, "Close selected event (fixture)").click();
  await expect(button(page, "Create new instructions")).toBeDisabled();
  await expect(button(page, "Simulate proposal upload")).toBeDisabled();
  await expect(button(page, "Approve and save draft")).toHaveCount(0);
  await button(page, "Back to brag").click();
  await expect(button(page, "My projects 0")).toBeVisible();
});
