import { test, expect, type Page } from "@playwright/test";

async function startSubmission(page: Page) {
  await page.goto("./#submit");
  await expect(page.getByRole("heading", { name: "Share what you built." })).toBeVisible();
}

async function fillDescription(page: Page) {
  await page.getByLabel("Project name", { exact: true }).fill("Trail journal");
  await page
    .getByLabel("What problem does it solve?")
    .fill("Hikers lose notes when the connection drops.");
  await page
    .getByLabel("What did you build?")
    .fill("A small notebook that saves field observations offline and uploads them later.");
  await page.getByRole("button", { name: "Your details", exact: true }).click();
}

async function fillAuthor(page: Page) {
  await page.getByLabel("Public display name").fill("Alex Builder");
  await page.getByLabel("Public contact email").fill("public-alex@example.com");
  await page.getByLabel("Private recovery email").fill("private-recovery@example.com");
  await page.getByRole("button", { name: "Review your project" }).click();
}

test("discovery searches descriptions, preserves context and supports saved projects", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByRole("article")).toHaveCount(6);
  await page.getByRole("textbox", { name: "Search projects" }).fill("voice");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Save Room for thought", exact: true }).click();
  await page.getByRole("button", { name: "Room for thought", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Room for thought", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email Tomas" })).toHaveAttribute(
    "href",
    "mailto:tomas@example.com",
  );
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page.getByRole("textbox", { name: "Search projects" })).toHaveValue("voice");
  await page.goto("./#saved");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Unsave Room for thought" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next good find is out there." }),
  ).toBeVisible();
});

test("scope, filters and no-match recovery work without pretending to use AI", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "All projects" }).click();
  await expect(page.getByRole("article")).toHaveCount(8);
  await page.getByRole("button", { name: "Patterns to learn" }).click();
  await expect(page.getByRole("article")).toHaveCount(4);
  await page.getByRole("textbox", { name: "Search projects" }).fill("no-such-capability");
  await expect(page.getByRole("heading", { name: "No projects found. Yet." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("article")).toHaveCount(8);
});

test("description-only review requires explicit verification and excludes private email", async ({
  page,
  baseURL,
}, testInfo) => {
  if (!baseURL) throw new Error("Catalogue tests require a baseURL");
  const catalogueOrigin = new URL(baseURL).origin;
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== catalogueOrigin) external.push(request.url());
  });
  await startSubmission(page);
  await fillDescription(page);
  await fillAuthor(page);
  await expect(page.getByRole("link", { name: "Email Alex" })).toHaveAttribute(
    "href",
    "mailto:public-alex@example.com",
  );
  await expect(page.getByText("private-recovery@example.com", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `.localfiles/screenshots/review-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await expect(page.getByRole("button", { name: "Share in this preview" })).toBeDisabled();
  await page.getByLabel("I’ve reviewed the project").check();
  await expect(page.getByRole("button", { name: "Share in this preview" })).toBeDisabled();
  await page.getByRole("button", { name: "Try email verification" }).click();
  await page.getByRole("button", { name: "Simulate opening the email link" }).click();
  await page.getByRole("button", { name: "Share in this preview" }).click();
  await expect(page.getByRole("heading", { name: "Trail journal", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View agent-readable record" }).click();
  const record = JSON.parse(await page.getByTestId("public-json").innerText());
  expect(record.public_author.contacts[0].value).toBe("public-alex@example.com");
  expect(record.provenance).toBe("Author described");
  expect(JSON.stringify(record)).not.toContain("private-recovery");
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page.getByRole("article")).toHaveCount(7);
  expect(external).toEqual([]);
});

test("repository suggestion stays editable and failure preserves manual input", async ({
  page,
}, testInfo) => {
  await startSubmission(page);
  await page.getByRole("button", { name: "Start from a repository" }).click();
  await expect(page.getByRole("button", { name: "Inspect sample repository" })).toBeDisabled();
  await page.getByLabel("Allow read-only inspection").check();
  await page.getByRole("button", { name: "Inspect sample repository" }).click();
  await expect(page.getByText("Preparing a sample description…")).toBeVisible();
  await page.getByRole("button", { name: "Use this suggestion" }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Pocket queue");
  await page.getByLabel("Project name", { exact: true }).fill("My edited queue");
  await page.screenshot({
    path: `.localfiles/screenshots/repository-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Simulate access failure" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Repository access is unavailable",
  );
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("My edited queue");
  await page.getByRole("button", { name: "Describe it myself" }).click();
  await page.getByRole("button", { name: "Your details", exact: true }).click();
  await fillAuthor(page);
  await expect(page.getByRole("heading", { name: "My edited queue", exact: true })).toBeVisible();
  await expect(page.getByText("demo-builder/pocket-queue")).toHaveCount(0);
});

test("private-repository detail exposes author contact and only a public record", async ({
  page,
}, testInfo) => {
  await page.goto("./#project/fieldnotes");
  await expect(page.getByRole("link", { name: "Email Mira" })).toHaveAttribute(
    "href",
    "mailto:mira@example.com",
  );
  await page.screenshot({
    path: `.localfiles/screenshots/detail-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "View agent-readable record" }).click();
  const record = JSON.parse(await page.getByTestId("public-json").innerText());
  expect(record.provenance).toBe("Private repository");
  expect(record.public_author.contacts[0].value).toBe("mira@example.com");
  expect(record).not.toHaveProperty("repository_url");
  expect(record).not.toHaveProperty("recovery_email");
  expect(record).not.toHaveProperty("source_code");
});

test("navigation preserves a draft and reset requires confirmation", async ({ page }) => {
  await startSubmission(page);
  await page.getByLabel("Project name", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Back to discovery" }).click();
  await page.getByRole("button", { name: "Share a project" }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Reset preview", exact: true }).click();
  await page.getByRole("button", { name: "Share a project" }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("");
});

test("responsive pages have no horizontal overflow or browser errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [route, heading] of [
    ["./", /Small projects/],
    ["./#project/fieldnotes", "Fieldnotes"],
    ["./#submit", "Share what you built."],
    ["./#agents", /Find the useful bit/],
    ["./#catalogue", "The pieces of brag.codes."],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /Small projects/, level: 1 })).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/discover-${testInfo.project.name}-viewport.png`,
  });
  await page.screenshot({
    path: `.localfiles/screenshots/discover-${testInfo.project.name}.png`,
    fullPage: true,
  });
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  expect(errors).toEqual([]);
});
