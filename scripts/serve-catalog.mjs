import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Loopback-only static catalogue server. No production endpoints or data writes.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../ui-catalog/out");
const port = Number(process.env.BRAG_PREVIEW_PORT || 3101);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let target = resolve(root, `.${pathname}`);
    const part = relative(root, target);
    if (isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if ((await stat(target)).isDirectory()) target = resolve(target, "index.html");
    const bytes = await readFile(target);
    response.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Catalogue preview: http://127.0.0.1:${port}\n`),
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
