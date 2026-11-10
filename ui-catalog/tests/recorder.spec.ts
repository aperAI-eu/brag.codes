import { test, expect, type Page } from "@playwright/test";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function recorder(page: Page) {
  await page.goto("./#share/home");
  await page.getByText("Preview scenarios and simulations", { exact: true }).click();
  await page.getByLabel("Account scenario", { exact: true }).selectOption("one");
  await button(page, "Share your work").click();
  await button(page, "Continue with Google").click();
  await button(page, "Simulate successful sign-in").click();
  await expect(page.getByRole("button", { name: /Record your pitch/ })).toContainText("30 seconds");
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await page.clock.install({ time: new Date("2026-11-09T17:30:00Z") });
  await page.clock.pauseAt(new Date("2026-11-09T17:30:01Z"));
}

async function browserCues(page: Page, blocked = false) {
  await page.addInitScript((blocked) => {
    const cues = { vibrations: 0, beeps: 0, opened: 0, closed: 0 };
    Object.defineProperty(window, "pitchCues", { value: cues });
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        if (blocked) throw new Error("Vibration denied");
        cues.vibrations++;
        return true;
      },
    });
    Object.defineProperty(window, "AudioContext", {
      value: class {
        state = "suspended";
        currentTime = 0;
        destination = {};
        constructor() {
          if (blocked) throw new Error("Audio unavailable");
          cues.opened++;
        }
        resume() {
          this.state = "running";
          return Promise.resolve();
        }
        close() {
          this.state = "closed";
          cues.closed++;
          return Promise.resolve();
        }
        createOscillator() {
          return {
            frequency: { value: 0 },
            connect: (node: unknown) => node,
            start: () => cues.beeps++,
            stop: () => {},
            disconnect: () => {},
          };
        }
        createGain() {
          return {
            gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
            connect: () => {},
            disconnect: () => {},
          };
        }
      },
    });
  }, blocked);
}
const cues = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          pitchCues: { vibrations: number; beeps: number; opened: number; closed: number };
        }
      ).pitchCues,
  );

async function prepareProposal(page: Page) {
  await page.clock.runFor(700);
  await expect(
    page.getByRole("heading", { name: "Claude is preparing your template…" }),
  ).toBeVisible();
  await page.clock.runFor(700);
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
}

test("recorder counts only captured time, warns once at 25 and finishes at 30", async ({
  page,
}, info) => {
  await browserCues(page);
  await recorder(page);
  const record = button(page, "Start recording");
  const box = await record.boundingBox();
  expect(box!.width).toBe(box!.height);
  await expect(record).toHaveCSS("border-radius", "50%");
  await page
    .getByRole("main")
    .screenshot({ path: `.localfiles/REQ-012/recorder-ready-${info.project.name}.png` });
  await record.focus();
  await page.keyboard.press("Enter");
  await expect(button(page, "Pause recording")).toBeFocused();
  await expect(button(page, "Finish pitch")).toHaveCount(0);
  await page.clock.runFor(12500);
  await page.keyboard.press("Enter");
  await expect(button(page, "Resume recording")).toBeFocused();
  await expect(page.getByRole("timer")).toHaveAccessibleName("12 of 30 seconds recorded");
  await page.clock.runFor(60000);
  await expect(page.getByRole("timer")).toHaveAccessibleName("12 of 30 seconds recorded");
  await expect(button(page, "Finish pitch")).toBeVisible();
  await page
    .getByRole("main")
    .screenshot({ path: `.localfiles/REQ-012/recorder-paused-${info.project.name}.png` });
  await button(page, "Resume recording").click();
  await page.clock.runFor(11500);
  await expect(page.getByRole("timer")).toHaveAccessibleName("24 of 30 seconds recorded");
  expect(await cues(page)).toMatchObject({ vibrations: 0, beeps: 0 });
  await page.clock.runFor(1000);
  await expect(
    page.getByText("5 seconds left · pauses don’t count", { exact: true }),
  ).toBeVisible();
  expect(await cues(page)).toMatchObject({ vibrations: 1, beeps: 1 });
  await page
    .getByRole("main")
    .screenshot({ path: `.localfiles/REQ-012/recorder-warning-${info.project.name}.png` });
  await button(page, "Pause recording").click();
  await page.clock.runFor(10000);
  await button(page, "Resume recording").click();
  await page.clock.runFor(4900);
  await expect(button(page, "Pause recording")).toBeVisible();
  expect(await cues(page)).toMatchObject({ vibrations: 1, beeps: 1 });
  await page.clock.runFor(100);
  await expect(page.getByRole("main")).toContainText("30-second limit reached");
  await expect(
    page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
  ).toBeVisible();
  expect(await cues(page)).toMatchObject({ closed: 1 });
  await expect(button(page, "Start recording")).toHaveCount(0);
  await prepareProposal(page);
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Poznámky bez internetu",
  );
});

test("leaving capture pauses it; manual finish preserves the approval gate and new pitch resets time", async ({
  page,
}) => {
  await browserCues(page);
  await recorder(page);
  await button(page, "Start recording").click();
  await page.clock.runFor(4000);
  await button(page, "Back to brag").click();
  await page.clock.runFor(40000);
  await button(page, "Share your work").click();
  await expect(button(page, "Resume recording")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveAccessibleName("4 of 30 seconds recorded");
  await button(page, "Expire session (fixture)").click();
  await button(page, "Continue with Google").click();
  await button(page, "Simulate successful sign-in").click();
  await expect(button(page, "Resume recording")).toBeVisible();
  await button(page, "Finish pitch").click();
  await expect(page.getByRole("main")).toContainText("Pitch finished. Preparing your draft");
  await prepareProposal(page);
  await expect(button(page, "Start recording")).toHaveCount(0);
  await button(page, "Approve and save draft").click();
  await page.clock.runFor(450);
  await button(page, "Share another project").click();
  await page.getByRole("button", { name: /Record your pitch/ }).click();
  await expect(page.getByRole("timer")).toHaveAccessibleName("0 of 30 seconds recorded");
  await button(page, "Start recording").click();
  await page.clock.runFor(25000);
  expect(await cues(page)).toMatchObject({ vibrations: 1, beeps: 1 });
});

for (const mode of ["muted", "unsupported"] as const) {
  test(`${mode} device feedback keeps visual warning and processing usable`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await browserCues(page, mode === "unsupported");
    await recorder(page);
    if (mode === "muted") await page.getByLabel("Play a short beep at 25 seconds").uncheck();
    await page.setViewportSize({ width: 320, height: 800 });
    await button(page, "Start recording").click();
    await page.clock.runFor(25000);
    await expect(
      page.getByText("Almost there — wrap up your pitch.", { exact: true }),
    ).toBeVisible();
    expect(await cues(page)).toMatchObject({ beeps: 0, vibrations: mode === "muted" ? 1 : 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await button(page, "Pause recording").click();
    await button(page, "Finish pitch").click();
    await expect(
      page.getByRole("heading", { name: "Distill is transcribing your pitch…" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
