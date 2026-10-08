import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  outputFileTracingIncludes: { "/methodology": ["../../docs/METHODOLOGY.md"] },
};

export default config;
