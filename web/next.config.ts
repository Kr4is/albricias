import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker image can run without node_modules.
  output: "standalone",
  // Mastra and its local store load native/dynamic modules Next's bundler
  // can't follow — each has to be listed by name (a `@mastra/*` glob is
  // matched literally, and silently matches nothing).
  serverExternalPackages: ["@mastra/core", "@mastra/libsql", "@mastra/observability", "@libsql/client"],
  // `src/mastra` builds a path to the local trace store; file tracing reads
  // that as a file the server needs and would copy it — traces and all —
  // into the production build. It's local-only: never ship it.
  outputFileTracingExcludes: {
    "*": ["./mastra.db*", "./.mastra/**", "./src/mastra/public/**"],
  },
};

export default nextConfig;
