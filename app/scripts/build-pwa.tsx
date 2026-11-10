import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineFallbackView } from "../src/ui/mobile-support";

// Built from the exact registered presentation and shared styles. Self-contained
// CSS/font keeps the cache allowlist small and independent of Next's private shell.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const font = await readFile(new URL("src/ui/assets/spacegrotesk.ttf", root));
const css = (
  await Promise.all(["styles", "access", "identity"].map((name) => read(`src/ui/${name}.css`)))
)
  .join("\n")
  .replaceAll("./assets/spacegrotesk.ttf", `data:font/ttf;base64,${font.toString("base64")}`);
const html =
  "<!doctype html>" +
  renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Connection needed · brag.codes</title>
        <meta name="robots" content="noindex,nofollow" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main className="access-main">
          <OfflineFallbackView retrying={false} message="" onRetry={() => {}} onHome={() => {}} />
          <noscript>
            Reconnect, then reload this page to try again. <a href="/">Back to brag</a>
          </noscript>
        </main>
        <script src="/pwa/offline.js" defer />
      </body>
    </html>,
  );
const script = await read("public/pwa/offline.js");
const worker = await read("src/mobile/worker.js");
const version = createHash("sha256")
  .update(html)
  .update(script)
  .update(worker)
  .digest("hex")
  .slice(0, 20);
await mkdir(new URL("public/pwa/", root), { recursive: true });
await writeFile(new URL("public/pwa/offline.html", root), html);
await writeFile(new URL("public/sw.js", root), worker.replace("__VERSION__", version));
console.log(`PWA offline assets built: ${version}`);
