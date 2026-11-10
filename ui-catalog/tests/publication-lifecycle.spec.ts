import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("./#publication-lifecycle");
}
async function review(page: Page) {
  await page.getByRole("button", { name: "Save and choose public details", exact: true }).click();
  await page.getByRole("button", { name: "Review public page", exact: true }).click();
}
async function approve(page: Page) {
  await page
    .getByRole("checkbox", {
      name: "I reviewed this version and its public contact details.",
      exact: true,
    })
    .check();
}

test("private changes remain private until reviewed update, with the old snapshot available", async ({
  page,
  baseURL,
}, info) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const original = await page.getByLabel("Project name", { exact: true }).inputValue();
  await page.getByLabel("Project name", { exact: true }).fill("Updated offline notebook");
  await page.getByRole("button", { name: "View current public page", exact: true }).click();
  await expect(page.getByRole("heading", { name: original, exact: true })).toBeVisible();
  await expect(page.getByText("Updated offline notebook", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to private editor", exact: true }).click();
  await review(page);
  await expect(page.getByRole("button", { name: "Publish update", exact: true })).toBeDisabled();
  await page.getByText("Previous publication · version 1", { exact: true }).click();
  await expect(page.getByRole("heading", { name: original, exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Updated offline notebook", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/lifecycle-review-${info.project.name}.png`,
    fullPage: true,
  });
  await approve(page);
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  await expect(
    page.getByText("Publication confirmed. Your public page is up to date."),
  ).toBeVisible();
  await page.getByRole("button", { name: "View current public page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated offline notebook", exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("withdrawal cancel keeps edits; confirm hides public content and republishing requires review", async ({
  page,
}, info) => {
  await open(page);
  await page.getByLabel("Project name", { exact: true }).fill("Private unfinished revision");
  await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
  await expect(
    page.getByText("Your unsaved edits stay in this editor.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `.localfiles/screenshots/lifecycle-withdraw-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Keep published", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Private unfinished revision",
  );
  await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
  await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
  await expect(page.getByText("Project withdrawn. Your private content is kept.")).toBeVisible();
  await page.getByRole("button", { name: "View current public page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project unavailable.", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Private unfinished revision", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to private editor", exact: true }).click();
  await review(page);
  await expect(page.getByRole("button", { name: "Publish again", exact: true })).toBeDisabled();
  await approve(page);
  await page.getByRole("button", { name: "Publish again", exact: true }).click();
  await expect(
    page.getByText("Publication confirmed. Your public page is up to date."),
  ).toBeVisible();
});

test("editing public choices clears approval and does not expose an unselected repository", async ({
  page,
}) => {
  await open(page);
  await review(page);
  await approve(page);
  await expect(
    page.getByText("https://example.com/private/offline-notes", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit public details", exact: true }).click();
  await page.getByLabel("Public display name", { exact: true }).fill("New public name");
  await page.getByRole("button", { name: "Review public page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish update", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Shared by New public name", exact: true }),
  ).toBeVisible();
});

for (const action of ["publish", "withdraw"] as const) {
  test(`${action}: definite failure retains input and lost response checks the original result`, async ({
    page,
  }) => {
    await open(page);
    if (action === "publish") {
      await review(page);
      await approve(page);
    } else await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
    const submit = page.getByRole("button", {
      name: action === "publish" ? "Publish update" : "Confirm withdrawal",
      exact: true,
    });
    await page.getByLabel("Next request outcome", { exact: true }).selectOption("failure");
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("failed before saving");
    await page.getByLabel("Next request outcome", { exact: true }).selectOption("lost");
    await submit.click();
    await expect(
      page.getByRole("heading", { name: "Checking the result.", exact: true }),
    ).toBeVisible();
    await expect(submit).toHaveCount(0);
    await page.getByRole("button", { name: "Check result", exact: true }).click();
    await expect(
      page.getByText(
        action === "publish"
          ? "Publication confirmed. Your public page is up to date."
          : "Project withdrawn. Your private content is kept.",
      ),
    ).toBeVisible();
  });
  test(`${action}: concurrent change forces a fresh review or confirmation`, async ({ page }) => {
    await open(page);
    await page.getByLabel("Project name", { exact: true }).fill("Retained private revision");
    if (action === "publish") {
      await review(page);
      await approve(page);
    } else await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
    await page.getByRole("button", { name: "Concurrent change (fixture)", exact: true }).click();
    await page
      .getByRole("button", {
        name: action === "publish" ? "Publish update" : "Confirm withdrawal",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "The project changed elsewhere.", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Review latest state", exact: true }).click();
    if (action === "publish") {
      await page.getByRole("button", { name: "Review public page", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Publish update", exact: true }),
      ).toBeDisabled();
    } else
      await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
        "Retained private revision",
      );
  });
}

test("closed event permits updates, publication restriction blocks updates but not withdrawal", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Event closed (fixture)", { exact: true }).check();
  await review(page);
  await approve(page);
  await page.getByLabel("Publishing restricted (fixture)", { exact: true }).check();
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("restricted");
  await page.getByLabel("Publishing restricted (fixture)", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  await expect(
    page.getByText("Publication confirmed. Your public page is up to date."),
  ).toBeVisible();
  await page.getByLabel("Publishing restricted (fixture)", { exact: true }).check();
  await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
  await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
  await expect(page.getByText("Project withdrawn. Your private content is kept.")).toBeVisible();
});

test("session recovery, loading and another account keep private data hidden; reset is deterministic", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Project name", { exact: true }).fill("Sensitive local work");
  await page.getByRole("button", { name: "Expire session (fixture)", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Resume same account (fixture)", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Sensitive local work",
  );
  await page.getByLabel("Loading (fixture)", { exact: true }).check();
  await expect(page.getByRole("heading", { name: "Loading project…", exact: true })).toBeVisible();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
  await page.getByLabel("Loading (fixture)", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Different account (fixture)", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project unavailable.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset preview", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).not.toHaveValue(
    "Sensitive local work",
  );
});

test("narrow screen, keyboard navigation and required input remain usable", async ({
  page,
}, info) => {
  await open(page);
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByLabel("Project name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save and choose public details", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("project name");
  await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.getByRole("button", { name: "Keep published", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("");
});
