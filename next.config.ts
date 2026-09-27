import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "pdf-parse",
    "pdfjs-dist",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "typebox",
  ],
  allowedDevOrigins: ["127.0.0.1"],
  // Next NFT often omits App Router route runtimes from standalone (pages work, /api 500).
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/next/dist/compiled/next-server/app-route*.js",
      "./node_modules/next/dist/compiled/next-server/app-page*.js",
      "./node_modules/next/dist/compiled/next-server/pages*.js",
      "./node_modules/next/dist/compiled/next-server/server*.js",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      "./dist/**/*",
      "./data/**/*",
      "./.workflow/**/*",
      "./electron/**/*",
      "./scripts/**/*",
    ],
  },
};

export default nextConfig;
