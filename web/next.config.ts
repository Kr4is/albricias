import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker image can run without node_modules.
  output: "standalone",
  // Mastra pulls in Node-only modules; keep it out of the server bundle.
  // Note: Next matches these names literally (see
  // node_modules/next/dist/build/handle-externals.js), so the `@mastra/*` glob
  // from Mastra's own docs does NOT work — list each package added in Phase 2
  // (e.g. @mastra/libsql) explicitly here.
  serverExternalPackages: ["@mastra/core"],
};

export default nextConfig;
