import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { expect, type Browser } from "@playwright/test";

export async function workerLifecycleChecks(t: TestContext, browser: Browser) {
  await t.test(
    "worker preserves HTTP failures, excludes callbacks/writes and waits over unsaved work",
    async () => {
      let version = 1,
        broken = false;
      const worker = await readFile("app/public/sw.js", "utf8"),
        offline = await readFile("app/public/pwa/offline.html"),
        script = await readFile("app/public/pwa/offline.js");
      const server = createServer((req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (req.url === "/sw.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(worker.replace(/brag-static-[a-f0-9]+/, `brag-static-test-${version}`));
        } else if (req.url === "/pwa/offline.html") {
          res.setHeader("Content-Type", "text/html");
          res.statusCode = broken ? 503 : 200;
          res.end(offline);
        } else if (req.url === "/pwa/offline.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(script);
        } else if (req.url === "/failure") {
          res.statusCode = 503;
          res.end("Actual server failure");
        } else {
          res.setHeader("Content-Type", "text/html");
          res.end('<title>Worker test</title><label>Unsaved work<input id="draft"></label>');
        }
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      const ctx = await browser.newContext();
      try {
        let page = await ctx.newPage();
        await page.goto(origin);
        await page.evaluate(async () => {
          await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
        });
        await page.reload();
        await expect
          .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
          .toBe(true);
        await page.goto(origin + "/failure");
        await expect(page.locator("body")).toHaveText("Actual server failure");
        await page.goto(origin);
        await page.getByLabel("Unsaved work").fill("Keep this review");
        await page.evaluate(async () => {
          await caches.open("unrelated-cache");
        });
        version = 2;
        await page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistration())!.update(),
        );
        await expect
          .poll(() =>
            page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
          )
          .toBe(true);
        await expect(page.getByLabel("Unsaved work")).toHaveValue("Keep this review");
        assert.ok((await page.evaluate(() => caches.keys())).includes("brag-static-test-1"));
        await page.close();
        page = await ctx.newPage();
        await page.goto(origin);
        await expect
          .poll(() => page.evaluate(() => caches.keys()))
          .toEqual(["unrelated-cache", "brag-static-test-2"]);
        // An incomplete upgrade leaves the old working fallback intact.
        broken = true;
        version = 3;
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration())!.update().catch(() => {});
        });
        await expect
          .poll(() =>
            page.evaluate(
              async () =>
                (await navigator.serviceWorker.getRegistration())?.installing?.state || "none",
            ),
          )
          .toBe("none");
        assert.deepEqual(await page.evaluate(() => caches.keys()), [
          "unrelated-cache",
          "brag-static-test-2",
        ]);
        await ctx.setOffline(true);
        const results = await page.evaluate(async () =>
          Promise.all(
            [
              fetch("/api/v1/private", { cache: "no-store" }),
              fetch("/api/auth/callback/github", { cache: "no-store" }),
              fetch("/write", { method: "POST", body: "unsaved" }),
              fetch("/pwa/offline.js?untrusted=1", { cache: "no-store" }),
            ].map((p) =>
              p.then(
                () => false,
                () => true,
              ),
            ),
          ),
        );
        assert.deepEqual(results, [true, true, true, true]);
        await page.goto(origin + "/new-page");
        await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
        const keys = await page.evaluate(async () =>
          (await (await caches.open("brag-static-test-2")).keys()).map(
            (r) => new URL(r.url).pathname,
          ),
        );
        assert.deepEqual(keys.sort(), ["/pwa/offline.html", "/pwa/offline.js"]);
      } finally {
        await ctx.close();
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    },
  );
}
