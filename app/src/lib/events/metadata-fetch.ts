import "server-only";
import { Resolver } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIPv4 } from "node:net";
import type { EventMetadata } from "../../events/metadata.ts";
import { normalizeSource, type Source } from "./validation.ts";
import { parseEventMetadata, unavailableMetadata } from "./metadata.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
export const publicIPv4 = (address: string) => isIPv4(address) && !blocked.check(address, "ipv4");

export type MetadataPage = { status: number; location?: string; html?: string };
export type MetadataTransport = (url: URL, signal: AbortSignal) => Promise<MetadataPage>;
export type MetadataLoader = (source: Source) => Promise<EventMetadata>;

/** Pin an independently checked IPv4 answer to this TLS connection, keeping hostname verification. */
export const downloadMetadataPage: MetadataTransport = async (url, signal) => {
  signal.throwIfAborted();
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  let addresses: string[];
  try {
    addresses = await resolver.resolve4(url.hostname);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.length > 16 ||
    addresses.some((address) => !publicIPv4(address))
  )
    throw new Error("Unsafe metadata destination");
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent: false,
        family: 4,
        servername: url.hostname,
        signal,
        maxHeaderSize: 16384,
        lookup: (_hostname, _options, callback) => callback(null, addresses[0], 4),
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
          "User-Agent": "brag.codes event preview/1.0",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status !== 200) {
          response.destroy();
          resolve({ status, location: response.headers.location });
          return;
        }
        if (
          !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
            response.headers["content-type"] || "",
          ) ||
          ![undefined, "identity"].includes(response.headers["content-encoding"]) ||
          Number(response.headers["content-length"] || 0) > MAX_BYTES
        ) {
          response.destroy();
          reject(new Error("Unsupported metadata response"));
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) response.destroy(new Error("Metadata response too large"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ status, html: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
};

let active = 0;
/** Best effort, authenticated preview enrichment; public event resolution never calls this. */
export async function loadEventMetadata(
  source: Source,
  transport: MetadataTransport = downloadMetadataPage,
): Promise<EventMetadata> {
  const unavailable = unavailableMetadata(source);
  if (!["luma", "meetup", "eventbrite"].includes(source.provider) || active >= 4)
    return unavailable;
  active++;
  try {
    const signal = AbortSignal.timeout(6000);
    let url = new URL(source.url);
    for (let redirects = 0; redirects <= 2; redirects++) {
      const normalized = normalizeSource(url.href, "https://metadata.invalid");
      if (normalized.provider !== source.provider || normalized.key !== source.key)
        return unavailable;
      const page = await transport(url, signal);
      if ([301, 302, 303, 307, 308].includes(page.status) && page.location) {
        url = new URL(page.location, url);
        continue;
      }
      return page.status === 200 &&
        typeof page.html === "string" &&
        Buffer.byteLength(page.html) <= MAX_BYTES
        ? parseEventMetadata(page.html, source)
        : unavailable;
    }
  } catch {
    /* Never return upstream bodies, addresses, cookies or errors to the browser/logs. */
  } finally {
    active--;
  }
  return unavailable;
}
