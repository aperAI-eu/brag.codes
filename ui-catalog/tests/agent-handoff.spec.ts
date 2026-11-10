import { test, expect, type Page } from "@playwright/test";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function openAgent(page: Page) {
  await page.goto("./#share/home");
  await page.getByText("Preview scenarios and simulations", { exact: true }).click();
  await page.getByLabel("Account scenario", { exact: true }).selectOption("one");
  await button(page, "Share your work").click();
  await button(page, "Continue with Google").click();
  await button(page, "Simulate successful sign-in").click();
  await page.getByRole("button", { name: /Use your AI agent/ }).click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).toBeVisible();
  await expect(button(page, "Simulate proposal upload")).toBeEnabled();
}
test("agent uploads one proposal directly into the language-preserving editor for owner approval", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    });
  });
  await openAgent(page);
  const instruction = await page.getByLabel("Agent instruction", { exact: true }).inputValue();
  expect(instruction).toContain("https://example.invalid/skill.md");
  expect(instruction).toContain("UPLOAD_TOKEN DEMO-UPLOAD-");
  expect(instruction).not.toMatch(/connection code|CODE_ID|\?TOKEN/);
  await button(page, "Copy agent instruction").click();
  await expect(page.getByRole("main")).toContainText("Copied. Paste it into your agent");
  expect(await page.locator("html").getAttribute("data-copied")).toBe(instruction);
  await expect(button(page, "Approve this agent")).toHaveCount(0);
  await button(page, "Simulate proposal upload").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
  await expect(page.getByRole("main")).toContainText("Content language: Slovak");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("main")).not.toContainText("Transcribe");
  await page.getByLabel("Project name", { exact: true }).fill("My agent project");
  await button(page, "Simulate duplicate upload").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("My agent project");
  await button(page, "Fail next save").click();
  await button(page, "Approve and save draft").click();
  await expect(page.getByRole("main")).toContainText("Save failed");
  await expect(button(page, "Share another project")).toHaveCount(0);
  await button(page, "Approve and save draft").click();
  await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
  await button(page, "Share another project").click();
  await page.getByRole("button", { name: /Use your AI agent/ }).click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).not.toHaveValue(instruction);
  await expect(page.getByRole("main")).toContainText("Waiting for your agent’s proposal");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("clipboard refusal has a selectable keyboard fallback and narrow layout", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
  });
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 850 });
  await openAgent(page);
  await button(page, "Copy agent instruction").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toContainText("copy it manually");
  const instruction = page.getByLabel("Agent instruction", { exact: true });
  await instruction.focus();
  await page.keyboard.press("ControlOrMeta+A");
  expect(
    await instruction.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe((await instruction.inputValue()).length);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await button(page, "Cancel upload instructions").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Upload instructions cancelled." })).toBeVisible();
});

test("cancellation and expiry renew instructions while preserving the unfinished project", async ({
  page,
}) => {
  await openAgent(page);
  const instruction = page.getByLabel("Agent instruction", { exact: true });
  const first = await instruction.inputValue();
  await button(page, "Cancel upload instructions").click();
  await expect(button(page, "Simulate proposal upload")).toBeDisabled();
  await button(page, "Create new instructions").click();
  await expect(instruction).not.toHaveValue(first);
  const second = await instruction.inputValue();
  await button(page, "Expire upload instructions").click();
  await expect(
    page.getByRole("heading", { name: "These upload instructions expired." }),
  ).toBeVisible();
  await button(page, "Create new instructions").click();
  await expect(instruction).not.toHaveValue(second);
  const third = await instruction.inputValue();
  await button(page, "Back to brag").click();
  await expect(button(page, "My projects 0")).toBeVisible();
  await button(page, "Resume unfinished project").click();
  await expect(instruction).toHaveValue(third);
});

test("an upload received while status checks are offline is recovered after closing and expiry", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await openAgent(page);
  await button(page, "Interrupt status check").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t check");
  await expect(button(page, "Cancel upload instructions")).toBeDisabled();
  await button(page, "Simulate proposal upload").click();
  await button(page, "Close selected event (fixture)").click();
  await page.clock.runFor(31 * 60_000);
  await button(page, "Check for proposal").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
  await expect(button(page, "Approve and save draft")).toBeEnabled();
  await button(page, "Approve and save draft").click();
  await page.clock.runFor(500);
  await expect(page.getByRole("heading", { name: "Project saved." })).toBeVisible();
});

test("closing blocks fresh uploads; session loss hides credentials and identity switching clears them", async ({
  page,
}) => {
  await openAgent(page);
  const instruction = await page.getByLabel("Agent instruction", { exact: true }).inputValue();
  await button(page, "Close selected event (fixture)").click();
  await expect(button(page, "Simulate proposal upload")).toBeDisabled();
  await button(page, "Expire session (fixture)").click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).toHaveCount(0);
  await button(page, "Continue with Google").click();
  await button(page, "Simulate successful sign-in").click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).toHaveValue(instruction);
  await button(page, "Cancel upload instructions").click();
  await expect(button(page, "Create new instructions")).toBeDisabled();
  await page.getByLabel("Sample identity", { exact: true }).selectOption("sam");
  await expect(page.getByRole("main")).not.toContainText("Upload instructions cancelled");
  await expect(page.getByLabel("Agent instruction", { exact: true })).toHaveCount(0);
});

test("unused instructions expire after thirty minutes without creating pending content", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await openAgent(page);
  await page.clock.runFor(30 * 60_000);
  await expect(
    page.getByRole("heading", { name: "These upload instructions expired." }),
  ).toBeVisible();
  await expect(button(page, "Simulate proposal upload")).toBeDisabled();
  await button(page, "Back to brag").click();
  await expect(button(page, "My projects 0")).toBeVisible();
});

test("unwanted proposal can be discarded explicitly without saving", async ({ page }) => {
  await openAgent(page);
  await button(page, "Simulate proposal upload").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await button(page, "Discard unfinished project").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await button(page, "Discard unfinished project").click();
  await expect(page.getByRole("heading", { name: "Project saved." })).toHaveCount(0);
  await button(page, "Back to brag").click();
  await expect(button(page, "My projects 0")).toBeVisible();
});

test("missing instructions can be replaced for the same project or overtaken by a received proposal", async ({
  page,
}) => {
  await openAgent(page);
  const original = await page.getByLabel("Agent instruction", { exact: true }).inputValue();
  await button(page, "Simulate missing instructions").click();
  await expect(
    page.getByRole("heading", { name: "Instructions aren’t available on this device." }),
  ).toBeVisible();
  await expect(page.getByLabel("Agent instruction", { exact: true })).toHaveCount(0);
  await button(page, "Create new instructions").click();
  await expect(page.getByLabel("Agent instruction", { exact: true })).not.toHaveValue(original);
  await button(page, "Simulate missing instructions").click();
  await button(page, "Simulate proposal upload").click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
  await expect(button(page, "Create new instructions")).toHaveCount(0);
});
