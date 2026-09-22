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
  turbopack: {
    // Next always builds an Edge-runtime compilation of instrumentation.ts
    // alongside the Node one, even though this app has no middleware/edge
    // routes and register()'s Node-only imports (src/instrumentation.ts)
    // are already gated on `NEXT_RUNTIME === "nodejs"`. Turbopack still
    // statically traces those dynamic imports for the Edge build and warns
    // about the Node builtins (fs/crypto/path/process.cwd) they pull in —
    // harmless noise, since that branch never runs under Edge.
    ignoreIssue: [
      { path: "src/lib/media-upload.ts" },
      { path: "src/lib/config/crypto.ts" },
      { path: "src/lib/edition-helpers.ts" },
      { path: "src/generated/prisma/**" },
    ],
  },
};

export default nextConfig;
