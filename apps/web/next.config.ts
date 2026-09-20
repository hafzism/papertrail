import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

// The workspace owns one uncommitted .env file. Next otherwise searches only apps/web.
// Force reload because the Next CLI has already checked its own project directory before it loads this config.
loadEnvConfig(resolve(import.meta.dirname, "../.."), true, console, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
