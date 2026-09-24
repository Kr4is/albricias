/**
 * Mastra's own API (agents, workflows, runs, traces, metrics…), served by
 * the app itself — locally only — for Mastra Studio: `npm run studio`
 * opens the Studio UI pointed here (`--server-port 3000
 * --server-api-prefix /api/mastra`).
 *
 * Why not `mastra dev`, which starts its own server: the traces live in
 * DuckDB, which lets only one process open its file. With a second server
 * holding it, either the app's runs or Studio's would fail to trace. Here
 * there's one process, one store, and Studio sees every run the app makes.
 *
 * In production this route doesn't exist: it answers 404 before loading
 * anything.
 */

import type { Hono } from "hono";
import { getMastra, isLocal } from "@/mastra";

const PREFIX = "/api/mastra";

const globalForServer = globalThis as unknown as { albriciasMastraApi?: Promise<Hono> };

/** The Hono app `@mastra/hono` registers every Mastra route on — built once per process. */
function api(): Promise<Hono> {
  globalForServer.albriciasMastraApi ??= (async () => {
    const [{ Hono }, { MastraServer }] = await Promise.all([import("hono"), import("@mastra/hono")]);
    const app = new Hono();
    await new MastraServer({ app, mastra: await getMastra(), prefix: PREFIX }).init();
    return app as unknown as Hono;
  })().catch((error) => {
    globalForServer.albriciasMastraApi = undefined;
    throw error;
  });
  return globalForServer.albriciasMastraApi;
}

/** Studio's UI runs on its own port, so every call here is cross-origin — allowed for local origins only. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !LOCAL_ORIGIN.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers") ?? "*",
    Vary: "Origin",
  };
}

async function handle(request: Request): Promise<Response> {
  if (!isLocal) return new Response("Not found", { status: 404 });
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const response = await (await api()).fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
