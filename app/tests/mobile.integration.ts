import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import QRCode from "qrcode";
import pg from "pg";
import { ownedFixture, migrateCandidate } from "./fixtures/owned-migration.ts";
import { identity, event } from "./fixtures/sharing-history.ts";
import { workerLifecycleChecks } from "./pwa-worker.integration.ts";
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function fakeCamera(context: BrowserContext, text: string | null, delay = 0) {
  const image = text ? await QRCode.toDataURL(text, { width: 480, margin: 4 }) : null;
  await context.addInitScript(
    ({ image, delay }) => {
      navigator.mediaDevices.getUserMedia = async () => {
        sessionStorage.setItem("starts", String(Number(sessionStorage.getItem("starts")) + 1));
        if (delay) await new Promise((r) => setTimeout(r, delay));
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 480;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 480, 480);
        if (image) {
          const img = new Image();
          img.src = image;
          await img.decode();
          ctx.drawImage(img, 0, 0);
        }
        const stream = canvas.captureStream(10);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            sessionStorage.setItem("stops", String(Number(sessionStorage.getItem("stops")) + 1));
            stop();
          };
        }
        return stream;
      };
    },
    { image, delay },
  );
}
test("mobile runtime: admin camera and installable private-safe shell", async (t) => {
  const f = await ownedFixture();
  assert.equal(migrateCandidate(f).status, 0);
  const db = new pg.Client({ connectionString: f.adminUrl });
  await db.connect();
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await db.end();
  });
  const actor = await identity(db, await readFile(f.authFile, "utf8"));
  await db.query(
    'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES($1,true,1,now())',
    [actor.owner],
  );
  const saved = await event(db);
  async function context(width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([
      {
        name: "brag.session_token",
        value: actor.cookie.slice("brag.session_token=".length),
        url: f.baseUrl,
      },
    ]);
    return context;
  }
  await t.test(
    "real QR uses protected existing candidate and stops tracks, unsafe QR stays local",
    async () => {
      const ctx = await context();
      await fakeCamera(ctx, saved.url);
      try {
        const page = await ctx.newPage();
        const requests: string[] = [];
        page.on("request", (r) => {
          if (r.url().includes("event-candidates/preview")) requests.push(r.postData()!);
        });
        await page.goto(f.baseUrl + "/admin");
        await button(page, "Add event").click();
        assert.equal(await page.evaluate(() => sessionStorage.getItem("starts")), null);
        await button(page, "Start camera").click();
        await expect(
          page.getByText("This link already belongs to the saved event below."),
        ).toBeVisible();
        assert.equal(await page.evaluate(() => sessionStorage.getItem("stops")), "1");
        assert.deepEqual(
          requests.map((v) => JSON.parse(v)),
          [{ url: saved.url }],
        );
        await page.goto(f.baseUrl + "/admin");
        await button(page, "Add event").click();
        await page
          .getByLabel("Or paste the event link")
          .fill("https://luma.com/a?ticket=private-token");
        await button(page, "Review event link").click();
        await expect(page.getByLabel("Or paste the event link")).toHaveValue("");
        assert.equal(requests.length, 1);
        await expect(page.locator("body")).not.toContainText("private-token");
      } finally {
        await ctx.close();
      }
    },
  );
  await t.test("late permission, background, help and role loss release camera", async () => {
    const ctx = await context();
    await fakeCamera(ctx, null, 250);
    try {
      const page = await ctx.newPage();
      await page.goto(f.baseUrl + "/admin");
      await button(page, "Add event").click();
      await button(page, "Start camera").click();
      await button(page, "Install / app help").click();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("stops"))).toBe("1");
      await button(page, "Continue where I was").click();
      await expect(button(page, "Start camera")).toBeVisible();
      await button(page, "Start camera").click();
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("stops"))).toBe("2");
      await button(page, "Start camera").click();
      await db.query('UPDATE brag.platform_role SET active=false WHERE "userId"=$1', [actor.owner]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(button(page, "Start camera")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("stops"))).toBe("3");
    } finally {
      await db.query('UPDATE brag.platform_role SET active=true WHERE "userId"=$1', [actor.owner]);
      await ctx.close();
    }
  });
  for (const width of [390, 1440])
    await t.test(
      `${width}px denied camera, new review, help/session retention and real explicit save`,
      async () => {
        const ctx = await context(width);
        await ctx.addInitScript(() => {
          navigator.mediaDevices.getUserMedia = async () => {
            throw new DOMException("Denied", "NotAllowedError");
          };
        });
        try {
          const page = await ctx.newPage(),
            slug = "mobile-" + randomUUID();
          // Only external metadata discovery is replaced; runtime whitelist/DB/save are real.
          await page.route("**/api/v1/admin/event-candidates/preview", (r) =>
            r.fulfill({
              contentType: "application/json",
              body: JSON.stringify({ url: `https://luma.com/${slug}`, metadata: null }),
            }),
          );
          await page.goto(f.baseUrl + "/admin");
          await button(page, "Add event").click();
          await button(page, "Start camera").click();
          await expect(page.locator("main").getByRole("alert")).toContainText("denied");
          await page.getByLabel("Or paste the event link").fill(`luma.com/${slug}`);
          await button(page, "Review event link").click();
          await page.getByLabel("Event title", { exact: true }).fill(`Mobile review ${width}`);
          await page.getByLabel("Event starts", { exact: true }).fill("2026-12-10T18:00");
          await button(page, "Install / app help").click();
          await button(page, "Continue where I was").click();
          await expect(page.getByLabel("Event title", { exact: true })).toHaveValue(
            `Mobile review ${width}`,
          );
          await ctx.clearCookies();
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByRole("heading", { name: "Sign in to resume your work." }),
          ).toBeVisible();
          await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
          await ctx.addCookies([
            {
              name: "brag.session_token",
              value: actor.cookie.slice("brag.session_token=".length),
              url: f.baseUrl,
            },
          ]);
          await button(page, "I’m signed in — check again").click();
          await expect(page.getByLabel("Event title", { exact: true })).toHaveValue(
            `Mobile review ${width}`,
          );
          assert.equal(
            (
              await db.query("SELECT id FROM brag.event_source_alias WHERE source_key=$1", [
                `luma:${slug}`,
              ])
            ).rowCount,
            0,
          );
          await page.screenshot({
            path: `.localfiles/runtime-evidence/mobile-review-${width}.png`,
            fullPage: true,
          });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await button(page, "Whitelist event").click();
          await expect(
            page.getByText("Saved. This event is available on your other devices."),
          ).toBeVisible();
          assert.equal(
            (
              await db.query("SELECT id FROM brag.event_source_alias WHERE source_key=$1", [
                `luma:${slug}`,
              ])
            ).rowCount,
            1,
          );
          await button(page, "Edit event").click();
          await page.getByLabel("Event title", { exact: true }).fill("Private unsaved admin edit");
          const other = await identity(db, await readFile(f.authFile, "utf8"));
          await ctx.clearCookies();
          await ctx.addCookies([
            {
              name: "brag.session_token",
              value: other.cookie.slice("brag.session_token=".length),
              url: f.baseUrl,
            },
          ]);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByRole("heading", { name: "Admin access unavailable." }),
          ).toBeVisible();
          await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
          await ctx.clearCookies();
          await ctx.addCookies([
            {
              name: "brag.session_token",
              value: actor.cookie.slice("brag.session_token=".length),
              url: f.baseUrl,
            },
          ]);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(button(page, "Add event")).toBeVisible();
          await expect(page.getByLabel("Event title", { exact: true })).toHaveCount(0);
        } finally {
          await ctx.close();
        }
      },
    );
  await t.test(
    "native prompt is click-only, consumed once, handles older userChoice and standalone",
    async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        await page.goto(f.baseUrl);
        await button(page, "Install / app help").click();
        await page.evaluate(`(() => {
          const event = new Event("beforeinstallprompt", { cancelable: true });
          Object.assign(event, {
            prompt: async () => {
              sessionStorage.setItem(
                "prompt-calls",
                String(Number(sessionStorage.getItem("prompt-calls")) + 1),
              );
            },
            userChoice: Promise.resolve({ outcome: "dismissed" }),
          });
          window.dispatchEvent(event);
        })()`);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("prompt-calls")), null);
        await button(page, "Install brag").click();
        await expect(page.getByText(/Installation cancelled/)).toBeVisible();
        assert.equal(await page.evaluate(() => sessionStorage.getItem("prompt-calls")), "1");
        await expect(button(page, "Install brag")).toHaveCount(0);
        await page.evaluate(`(() => {
          const e = new Event("beforeinstallprompt");
          Object.assign(e, {
            prompt: async () => {
              throw new Error("Failed");
            },
          });
          window.dispatchEvent(e);
        })()`);
        await button(page, "Install brag").click();
        await expect(page.locator("main").getByRole("alert")).toContainText("couldn’t open");
        await page.evaluate(`(() => {
          const e = new Event("beforeinstallprompt");
          Object.assign(e, { prompt: async () => ({ outcome: "accepted" }) });
          window.dispatchEvent(e);
})()`);
        await button(page, "Install brag").click();
        await expect(page.getByText(/browser accepted/)).toBeVisible();
        await page.screenshot({
          path: ".localfiles/runtime-evidence/mobile-help.png",
          fullPage: true,
        });
        await ctx.addInitScript(() =>
          Object.defineProperty(navigator, "standalone", { value: true }),
        );
        await page.reload();
        await button(page, "Install / app help").click();
        await expect(page.getByText(/You’re using the app/)).toBeVisible();
      } finally {
        await ctx.close();
      }
    },
  );
  await t.test(
    "manifest, icons and real worker keep only static fallback; APIs never work offline",
    async () => {
      const manifest = await fetch(f.baseUrl + "/manifest.webmanifest").then((r) => r.json());
      assert.equal(manifest.id, "/");
      assert.equal(manifest.start_url, "/");
      assert.equal(manifest.display, "standalone");
      for (const icon of [...manifest.icons, { src: "/pwa/apple-touch-icon.png" }]) {
        const r = await fetch(f.baseUrl + icon.src);
        assert.equal(r.status, 200);
        assert.match(r.headers.get("content-type")!, /image\/png/);
      }
      const worker = await fetch(f.baseUrl + "/sw.js");
      assert.match(worker.headers.get("cache-control")!, /no-cache/);
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        await page.goto(f.baseUrl + "/admin");
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
        await page.reload();
        await expect
          .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
          .toBe(true);
        const keys = await page.evaluate(async () =>
          (
            await Promise.all(
              (await caches.keys()).map(async (k) =>
                (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname),
              ),
            )
          ).flat(),
        );
        assert.deepEqual(keys.sort(), ["/pwa/offline.html", "/pwa/offline.js"]);
        await ctx.setOffline(true);
        // Loaded work stays in place; no worker-triggered navigation on connectivity loss.
        await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
        assert.equal(
          await page.evaluate(() =>
            fetch("/api/v1/session", { cache: "no-store" }).then(
              () => false,
              () => true,
            ),
          ),
          true,
        );
        await page.goto(f.baseUrl + "/my/projects?offline-test=1");
        await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
        await expect(page.locator("body")).not.toContainText("Sharing fixture");
        await page.screenshot({
          path: ".localfiles/runtime-evidence/mobile-offline.png",
          fullPage: true,
        });
        await button(page, "Try again").click();
        await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
        await ctx.setOffline(false);
        await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
        await button(page, "Try again").click();
        await expect(page.getByRole("heading", { name: "You’re offline." })).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    },
  );
  await workerLifecycleChecks(t, browser);
});
