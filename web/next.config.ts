import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker image can run without node_modules.
  output: "standalone",
  // Mastra and its local store load native/dynamic modules Next's bundler
  // can't follow — each has to be listed by name (a `@mastra/*` glob is
  // matched literally, and silently matches nothing).
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/libsql",
    "@mastra/duckdb",
    "@mastra/observability",
    "@mastra/hono",
    "@mastra/server",
    "@libsql/client",
    "@duckdb/node-api",
    "@duckdb/node-bindings",
  ],
  // The local trace stores and DuckDB's native engine are local-only —
  // production never loads them (see `src/mastra`) — but file tracing reads
  // the stores' paths as files the server needs and would copy them, traces
  // and all, into the production build. Never ship either.
  // Mastra Studio (`npm run studio`, its own port) checks the app is up by
  // fetching its root cross-origin before talking to `/api/mastra`. Local only.
  async headers() {
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/", headers: [{ key: "Access-Control-Allow-Origin", value: "http://localhost:4111" }] }];
  },
  outputFileTracingExcludes: {
    "*": ["./mastra.db*", "./mastra.duckdb*", "./.mastra/**", "./src/mastra/public/**", "./node_modules/@duckdb/**"],
  },
};

export default nextConfig;
