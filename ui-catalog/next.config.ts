import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  output: "export",
  basePath: process.env.BRAG_CATALOGUE_BASE_PATH === "/catalogue" ? "/catalogue" : "",
  devIndicators: false,
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
};
export default config;
