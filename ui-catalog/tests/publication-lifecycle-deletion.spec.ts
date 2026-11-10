import { test, expect, type Page } from "@playwright/test";

async function openDelete(page: Page) {
  await page.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Delete this project?", exact: true }),
  ).toBeVisible();
}

for (const visibility of ["published", "withdrawn"] as const) {
  test(`${visibility} editor retains permanent deletion and cancellation preserves private edits`, async ({
    page,
  }, info) => {
    await page.goto("./#publication-lifecycle");
    const savedTitle = await page.getByLabel("Project name", { exact: true }).inputValue();
    if (visibility === "withdrawn") {
      await page.getByRole("button", { name: "Withdraw from gallery", exact: true }).click();
      await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
      await expect(
        page.getByText("Project withdrawn. Your private content is kept."),
      ).toBeVisible();
    }
    await page.getByLabel("Project name", { exact: true }).fill("Unsaved owner revision");
    await page
      .getByRole("button", { name: "Delete project", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.localfiles/screenshots/lifecycle-delete-action-${visibility}-${info.project.name}.png`,
      fullPage: true,
    });
    await openDelete(page);
    await expect(page.getByRole("heading", { name: savedTitle, exact: true })).toBeVisible();
    await expect(
      page.getByText("You have unsaved changes. Deleting also discards these edits."),
    ).toBeVisible();
    const publicWarning = page.getByText(
      "The public project page and its event listings will also be removed.",
    );
    if (visibility === "published") await expect(publicWarning).toBeVisible();
    else await expect(publicWarning).toHaveCount(0);
    await page.getByRole("button", { name: "Keep project", exact: true }).click();
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
      "Unsaved owner revision",
    );
    await openDelete(page);
    await page.screenshot({
      path: `.localfiles/screenshots/lifecycle-delete-confirm-${visibility}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Project deleted.", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Publish again|Save and choose public details/ }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "brag.codes — Prompt flag / Sage & Copper" }).click();
    await expect(
      page.getByRole("heading", { name: "Project deleted.", exact: true }),
    ).toBeVisible();
  });
}

test("deletion handles stale state, definite failure and lost successful response", async ({
  page,
}) => {
  await page.goto("./#publication-lifecycle");
  await openDelete(page);
  await page.getByRole("button", { name: "Concurrent change (fixture)", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("changed in another tab");
  await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Review latest project", exact: true }).click();
  await openDelete(page);
  await page.getByLabel("Next request outcome", { exact: true }).selectOption("failure");
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("failed before saving");
  await page.getByLabel("Next request outcome", { exact: true }).selectOption("lost");
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check deletion", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "Project deleted.", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Check deletion", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project deleted.", exact: true })).toBeVisible();
});

test("deletion confirmation survives same-account recovery and hides from a different account", async ({
  page,
}) => {
  await page.goto("./#publication-lifecycle");
  await openDelete(page);
  await page.getByRole("button", { name: "Expire session (fixture)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Resume same account (fixture)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Different account (fixture)", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project unavailable.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(
    0,
  );
});

test("closed or restricted project keeps deletion, with keyboard access and narrow-screen fit", async ({
  page,
}, info) => {
  await page.goto("./#publication-lifecycle");
  if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 800 });
  await page.getByLabel("Event closed (fixture)", { exact: true }).check();
  await page.getByLabel("Publishing restricted (fixture)", { exact: true }).check();
  await page.getByRole("button", { name: "Delete project", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "Keep project", exact: true }).focus();
  await page.keyboard.press("Enter");
  await openDelete(page);
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project deleted.", exact: true })).toBeVisible();
});
