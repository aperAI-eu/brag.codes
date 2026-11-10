import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { chromium, expect, type BrowserContext } from "@playwright/test";
import QRCode from "qrcode";

export async function scannerChecks(
  t: TestContext,
  origin: string,
  cookie: string,
  eventId: string,
  source: string,
) {
  const browser = await chromium.launch({ headless: true });
  const pair = cookie.split("; ").find((v) => v.startsWith("brag.session_token="))!;
  async function context(signedIn = true) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (signedIn)
      await ctx.addCookies([
        {
          name: "brag.session_token",
          value: pair.slice(pair.indexOf("=") + 1),
          url: origin,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    return ctx;
  }
  async function camera(ctx: BrowserContext, text: string | null, delay = 0) {
    const image = text ? await QRCode.toDataURL(text, { width: 480, margin: 4 }) : null;
    // Only the media device is substituted. Video, canvas, jsQR, resolver and navigation are real.
    await ctx.addInitScript(
      ({ image, delay }) => {
        navigator.mediaDevices.getUserMedia = async () => {
          sessionStorage.setItem(
            "camera-starts",
            String(Number(sessionStorage.getItem("camera-starts")) + 1),
          );
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 480;
          const drawing = canvas.getContext("2d")!;
          drawing.fillStyle = "white";
          drawing.fillRect(0, 0, 480, 480);
          if (image) {
            const qr = new Image();
            qr.src = image;
            await qr.decode();
            drawing.drawImage(qr, 0, 0);
          }
          const stream = canvas.captureStream(10);
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              sessionStorage.setItem(
                "camera-stops",
                String(Number(sessionStorage.getItem("camera-stops")) + 1),
              );
              stop();
            };
          }
          return stream;
        };
      },
      { image, delay },
    );
  }
  const choices = async (page: Awaited<ReturnType<BrowserContext["newPage"]>>) => {
    await page.getByRole("button", { name: "Continue to project options" }).click();
    await expect(page).toHaveURL(origin + `/events/${eventId}/submit`);
    for (const name of ["Type it in", "Record your pitch", "Use your AI agent"])
      await expect(page.getByRole("button", { name: new RegExp(name) })).toBeEnabled();
  };
  try {
    await t.test(
      "signed-in homepage scans a real QR image into the three event capture choices",
      async () => {
        const ctx = await context();
        try {
          await camera(ctx, source);
          const page = await ctx.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const requests: string[] = [];
          page.on("request", (request) => {
            if (request.method() === "POST" && request.url().includes("/api/v1/me/events"))
              requests.push(request.postData()!);
          });
          await page.goto(origin);
          await page.getByRole("button", { name: "Scan another event" }).click();
          await expect(page.getByRole("heading", { name: "Scan the event QR." })).toBeVisible();
          assert.equal(await page.evaluate(() => sessionStorage.getItem("camera-starts")), null);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: ".localfiles/runtime-evidence/scanner-mobile.png" });
          await page.getByRole("button", { name: "Start camera" }).click();
          await choices(page);
          assert.equal(await page.evaluate(() => sessionStorage.getItem("camera-stops")), "1");
          assert.deepEqual(
            requests.map((v) => JSON.parse(v)),
            [{ url: source, entry_method: "qr_scan" }],
          );
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      },
    );
    await t.test(
      "anonymous scanner requires login before capture; denied camera permits bare-link paste after login",
      async () => {
        const ctx = await context(false);
        try {
          await ctx.addInitScript(() => {
            navigator.mediaDevices.getUserMedia = async () => {
              throw new DOMException("Denied", "NotAllowedError");
            };
          });
          const page = await ctx.newPage();
          await page.goto(origin + "/scan");
          await expect(page).toHaveURL(origin + "/sign-in?return_to=%2Fscan");
          assert.equal(await page.getByRole("button", { name: "Start camera" }).count(), 0);
          await ctx.addCookies([
            {
              name: "brag.session_token",
              value: pair.slice(pair.indexOf("=") + 1),
              url: origin,
              httpOnly: true,
              sameSite: "Lax",
            },
          ]);
          await page.goto(origin + "/scan");
          await page.getByRole("button", { name: "Start camera" }).click();
          await expect(page.getByRole("main").getByRole("alert")).toContainText(
            "Camera access was denied",
          );
          const requests: string[] = [];
          page.on("request", (r) => {
            if (r.method() === "POST" && r.url().includes("/api/v1/me/events"))
              requests.push(r.postData()!);
          });
          await page.getByLabel("Or paste the event link").fill(source.replace(/^https:\/\//, ""));
          await page.getByRole("button", { name: "Find event" }).click();
          await choices(page);
          assert.deepEqual(
            requests.map((v) => JSON.parse(v)),
            [{ url: source, entry_method: "pasted_url" }],
          );
        } finally {
          await ctx.close();
        }
      },
    );
    await t.test(
      "camera stops on background, cancel and late permission without navigating",
      async () => {
        const ctx = await context();
        try {
          await camera(ctx, null, 350);
          const page = await ctx.newPage();
          await page.goto(origin + "/scan");
          await page.getByRole("button", { name: "Start camera" }).click();
          await page.getByRole("button", { name: "Stop camera" }).click();
          await expect
            .poll(() => page.evaluate(() => sessionStorage.getItem("camera-stops")))
            .toBe("1");
          await expect(page.getByRole("status")).toContainText("Camera stopped");
          await page.getByRole("button", { name: "Start camera" }).click();
          await expect(page.getByRole("status")).toContainText("Point your camera");
          await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "hidden",
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          await expect(page.getByRole("status")).toContainText("Scanning paused");
          assert.equal(await page.evaluate(() => sessionStorage.getItem("camera-stops")), "2");
          await page.evaluate(() =>
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "visible",
            }),
          );
          await page.getByRole("button", { name: "Start camera" }).click();
          await expect(page.getByRole("status")).toContainText("Point your camera");
          await page.getByRole("button", { name: "Back to brag" }).click();
          await expect(page).toHaveURL(origin + "/");
          assert.equal(await page.evaluate(() => sessionStorage.getItem("camera-stops")), "3");
        } finally {
          await ctx.close();
        }
      },
    );
    await t.test(
      "unsafe QR remains local, unknown event and offline errors recover without a fabricated room",
      async () => {
        const ctx = await context();
        try {
          await camera(ctx, "https://luma.com/ticket?secret=private-ticket");
          const page = await ctx.newPage();
          let resolves = 0;
          page.on("request", (request) => {
            if (request.method() === "POST" && request.url().includes("/api/v1/me/events"))
              resolves++;
          });
          await page.goto(origin + "/scan");
          await page.getByRole("button", { name: "Start camera" }).click();
          await expect(page.getByRole("main").getByRole("alert")).toContainText(
            "isn’t a supported public event link",
          );
          assert.equal(resolves, 0);
          assert.equal((await page.content()).includes("private-ticket"), false);
          await page
            .getByLabel("Or paste the event link")
            .fill("luma.com/blxy7j09?ticket=private-ticket");
          await page.getByRole("button", { name: "Find event" }).click();
          await expect(page.getByLabel("Or paste the event link")).toHaveValue("");
          await expect(page.getByRole("main").getByRole("alert")).toContainText(
            "isn’t a supported public event link",
          );
          assert.equal(resolves, 0);
          await page.getByLabel("Or paste the event link").fill("https://luma.com/not-whitelisted");
          await page.getByRole("button", { name: "Find event" }).click();
          await expect(page.getByRole("main").getByRole("alert")).toContainText(
            "hasn’t been whitelisted",
          );
          await ctx.route("**/api/v1/me/events", (route) => route.abort("internetdisconnected"));
          await page.getByLabel("Or paste the event link").fill(source);
          await page.getByRole("button", { name: "Find event" }).click();
          await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t connect");
          await ctx.unroute("**/api/v1/me/events");
          await page.getByLabel("Or paste the event link").fill(source);
          await page.getByRole("button", { name: "Find event" }).click();
          await choices(page);
        } finally {
          await ctx.close();
        }
      },
    );
  } finally {
    await browser.close();
  }
}
