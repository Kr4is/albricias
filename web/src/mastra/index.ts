/**
 * The Mastra instance: the two newsroom agents and the `front-page`
 * workflow. `/api/generate` runs the workflow through it.
 *
 * Locally (anything but `NODE_ENV=production`) it also keeps a store and
 * traces every run into it — each step's input and output, every model
 * call with its prompt, reply, tokens and timing — and serves Mastra's
 * API at `/api/mastra` (`src/app/api/mastra/[...path]`), which Mastra
 * Studio (`npm run studio`) connects to. One process owns everything: the
 * traces live in DuckDB, which lets only one process open its file, so
 * Studio talks to the app's own server instead of starting a second one —
 * and sees exactly the runs the app made.
 *
 *   mastra.db      LibSQL — workflow runs and their snapshots
 *   mastra.duckdb  DuckDB — traces, logs and metrics (what Studio's
 *                  Traces and Metrics screens query; LibSQL can't)
 *
 * In production neither exists — the local-only packages aren't even
 * loaded: the app stays stateless, and nothing a visitor generates is
 * written anywhere. (Mastra logs a one-time "no storage configured"
 * warning at boot — expected; the workflow's `shouldPersistSnapshot`
 * keeps even its in-memory store empty.)
 *
 * Next.js needs every `@mastra/*` package listed by name in
 * `serverExternalPackages` (next.config.ts).
 */

import path from "node:path";
import { Mastra } from "@mastra/core";

import { correspondent, outlineEditor } from "./agents";
import { frontPageWorkflow } from "./workflows/front-page";

export const isLocal = process.env.NODE_ENV !== "production";

/** The store and tracing for local runs — imported only here, so production never loads them. */
async function localOptions() {
  const [{ LibSQLStore }, { DuckDBStore }, { MastraCompositeStore }, observability] = await Promise.all([
    import("@mastra/libsql"),
    import("@mastra/duckdb"),
    import("@mastra/core/storage"),
    import("@mastra/observability"),
  ]);
  // `next dev` runs from the project root.
  const root = process.cwd();
  return {
    storage: new MastraCompositeStore({
      id: "albricias-local",
      default: new LibSQLStore({ id: "albricias-runs", url: `file:${path.join(root, "mastra.db")}` }),
      domains: {
        observability: await new DuckDBStore({ path: path.join(root, "mastra.duckdb") }).getStore("observability"),
      },
    }),
    observability: new observability.Observability({
      configs: {
        default: {
          serviceName: "albricias",
          exporters: [new observability.MastraStorageExporter()],
          // Redacts anything key-shaped (API keys, tokens) from what's stored.
          spanOutputProcessors: [new observability.SensitiveDataFilter()],
        },
      },
    }),
  };
}

async function createMastra(): Promise<Mastra> {
  return new Mastra({
    agents: { outlineEditor, correspondent },
    workflows: { frontPage: frontPageWorkflow },
    ...(isLocal ? await localOptions() : {}),
  });
}

// One instance per process: `next dev` re-evaluates modules on every edit,
// and a second instance would try to open `mastra.duckdb` again — which
// DuckDB refuses while the first still holds it.
const globalForMastra = globalThis as unknown as { albriciasMastra?: Promise<Mastra> };

export function getMastra(): Promise<Mastra> {
  globalForMastra.albriciasMastra ??= createMastra().catch((error) => {
    globalForMastra.albriciasMastra = undefined;
    throw error;
  });
  return globalForMastra.albriciasMastra;
}
