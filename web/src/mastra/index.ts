/**
 * The Mastra instance: the two newsroom agents and the `front-page`
 * workflow. `/api/generate` runs the workflow through it; `npm run mastra`
 * (`mastra dev`) opens Mastra Studio on it.
 *
 * Locally (anything but `NODE_ENV=production`) it also keeps a LibSQL
 * store in `mastra.db` with tracing into it — every run, whether started
 * from the app or from Studio, lands there as a trace: each step's input
 * and output, every model call with its prompt, reply, tokens and timing.
 * Studio reads the same file, so a front page generated in the browser can
 * be inspected in Studio right after. In production neither exists: the
 * app stays stateless, and nothing a visitor generates is written anywhere
 * (Mastra logs a one-time "no storage configured" warning at boot — expected;
 * the workflow's `shouldPersistSnapshot` keeps even its in-memory store empty).
 *
 * Next.js needs every `@mastra/*` package listed by name in
 * `serverExternalPackages` (next.config.ts).
 */

import path from "node:path";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";

import { correspondent, outlineEditor } from "./agents";
import { frontPageWorkflow } from "./workflows/front-page";

const local = process.env.NODE_ENV !== "production";

/** Where `mastra dev` runs its server from, relative to the project root. */
const STUDIO_DIRS = [path.join("src", "mastra", "public"), path.join(".mastra", "output")];

/**
 * `mastra.db` at the project root. `next dev` runs from the root, but
 * `mastra dev` runs its server from inside its own build
 * (`src/mastra/public`), and both must land on the same file for Studio to
 * see the app's runs. Worked out from the path alone: touching the
 * filesystem here would make Next trace the whole project into the
 * production build.
 */
function localDbUrl(): string {
  if (process.env.MASTRA_DB_URL) return process.env.MASTRA_DB_URL;
  const cwd = process.cwd();
  const inner = STUDIO_DIRS.find((dir) => cwd.endsWith(path.sep + dir));
  const root = inner ? cwd.slice(0, -(inner.length + 1)) : cwd;
  return `file:${path.join(root, "mastra.db")}`;
}

function createMastra(): Mastra {
  return new Mastra({
    agents: { outlineEditor, correspondent },
    workflows: { frontPage: frontPageWorkflow },
    ...(local && {
      storage: new LibSQLStore({ id: "albricias-local", url: localDbUrl() }),
      observability: new Observability({
        configs: {
          default: {
            serviceName: "albricias",
            exporters: [new MastraStorageExporter()],
            // Redacts anything key-shaped (API keys, tokens) from what's stored.
            spanOutputProcessors: [new SensitiveDataFilter()],
          },
        },
      }),
    }),
  });
}

// One instance per process: `next dev` re-evaluates modules on every edit,
// and each fresh instance would open another handle on `mastra.db`.
const globalForMastra = globalThis as unknown as { albriciasMastra?: Mastra };
export const mastra = globalForMastra.albriciasMastra ?? createMastra();
if (local) globalForMastra.albriciasMastra = mastra;
