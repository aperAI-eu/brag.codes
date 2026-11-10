import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  for (const [name, size] of [
    ["icon-192", 192],
    ["icon-512", 512],
    ["maskable-512", 512],
    ["apple-touch-icon", 180],
  ]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const svg = name.startsWith("maskable")
      ? source.replace("translate(16 16) scale(.68)", "translate(20 20) scale(.6)")
      : source;
    await page.setContent(
      `<style>html,body{margin:0;background:#7c9070;width:100%;height:100%}svg{width:100%;height:100%;display:block}</style>${svg}`,
    );
    await page.screenshot({ path: new URL(`../public/pwa/${name}.png`, import.meta.url).pathname });
    await page.close();
  }
} finally {
  await browser.close();
}
