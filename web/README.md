# ¡Albricias! — web

Self-serve, stateless GitHub-activity newspaper generator. See the
repo-root `README.md` for the product overview.

## Setup

```bash
npm run setup   # installs deps, creates .env from .env.example if missing
npm run dev
```

Set `GITHUB_TOKEN` in `.env`: a personal access token with no special
scopes, used server-side for every visitor's read-only activity lookup
(visitors only ever supply a GitHub *username*, never a token). Without it,
GitHub's unauthenticated rate limits (10 req/min on the search API) are
exhausted almost immediately.

Open [http://localhost:3000](http://localhost:3000): `/` is the landing
page, `/app` is the generator. There is no login and nothing is saved —
every "Print My Edition" is one request from form submission to rendered
front page.

## How generation works

`POST /api/generate` (`src/app/api/generate/route.ts`) validates the form,
puts the visitor's model (their provider + BYO key, built by
`src/lib/ai/resolve.ts`) into the run's request context, and runs the
`front-page` [Mastra](https://mastra.ai) workflow
(`src/mastra/workflows/front-page.ts`):

1. **gather** — the user's GitHub activity for the period
   (`src/lib/sources/github.ts`, on the server's `GITHUB_TOKEN`, every event
   type fetched in parallel), plus what each repo touched *is*
   (description, language, stars, topics), built into a typed JSON dossier
   (`src/lib/generation/dossier.ts`): every commit in order with its
   conventional-commit type and local hour, PRs, issues, releases, stars,
   and the facts worth a headline already counted — streaks, busiest day
   and hour, commit mix, the week-by-week arc, new repos, contributions to
   other people's.
2. **plan** — the `outline-editor` agent reads the dossier and plans the
   page as a typed object (`outlineSchema`, `src/lib/generation/outline.ts`,
   via Mastra structured output): headline, premise, and per section a
   kind (`feature`, `roundup`, `overview`, `reading-list`), brief, length,
   the repos it covers and, when several sections split one busy repo, the
   days each one covers.
3. **review** — no model: the outline checked against the dossier and
   fixed in code (`reviewOutline`). Repo names are resolved (typos
   included) or dropped, kinds made to fit their repos, the stars get one
   section at most and never the longest, the lead is the biggest piece of
   work, the section count stays in range, and forgotten work joins a
   round-up. Every change is listed in the step's `notes` (visible in
   Studio). A section about a real repo gets that repo's GitHub card as its
   picture.
4. **write-section** (`ALBRICIAS_SECTION_CONCURRENCY` at a time, 2 by
   default) — the `correspondent` agent writes it, from only its slice of
   the dossier: the overview for an `overview`, the stars for a reading
   list, otherwise its repos over its days, plus one line on everything
   else.
5. **assemble** — the boxes computed without any model: the repos starred
   this period (left out when a reading list already covers them), and the
   numbers (`src/lib/generation/deterministic-articles.ts`).

With the LLM Gateway provider, the form's **Thinking** choice says where a
thinking model (Qwen and the like, served by vLLM or SGLang, directly or
behind LiteLLM) may reason: everywhere, only while planning the outline, or
nowhere — sent per call as `chat_template_kwargs.enable_thinking: false`
(`thinkingOff`, `src/lib/ai/resolve.ts`). Reasoning is most of such a
model's output and time; "Outline only" keeps the careful plan and writes
the sections fast. The gateway runs through `@ai-sdk/openai-compatible`,
which reads the model's `reasoning_content`, so the reasoning shows in
Studio's traces.

Each step reports to the page as it goes (`writer.write({ event, data })`);
the route relays those as Server-Sent Events, so the page shows each
section being written, token by token. The prompts live in
`src/lib/generation/period-post.ts`.

The client (`src/components/AppClient.tsx`) renders the edition in one of
six layouts (`src/components/issue/`), then measures it and levels its
columns so they end on the same line (`src/components/usePageFill.ts`,
`src/lib/balance.ts`), and can export it as a PNG
(`src/components/ExportActions.tsx`).

## Mastra Studio (local only)

With `npm run dev` running, in a second terminal:

```bash
npm run studio   # Studio UI on http://localhost:4111, connected to the app
```

Studio shows the two agents and the `front-page` workflow, and every run's
trace: each step's input and output, every model call with its prompt,
reply, tokens and timing — plus metrics across runs. Runs started from the
app land there as they happen, so you can generate a front page in the
browser and inspect exactly what each call was asked and answered.

Studio is only the UI: it talks to the app's own dev server, which serves
Mastra's API at `/api/mastra` (`src/app/api/mastra/[...path]/route.ts`).
That's deliberate — the traces live in DuckDB (`mastra.duckdb`; runs in
`mastra.db`), which only one process may open, so a separate `mastra dev`
server would lock the app out of its own traces. If the app isn't on port
3000, change `--server-port` in the `studio` script. The first time, if
Studio asks for the instance, it's `http://localhost:3000` with API prefix
`/api/mastra`.

To run the workflow from Studio itself, give it a model in `.env`
(`ALBRICIAS_LLM_*`, see `.env.example`); runs from the app always use the
visitor's own.

None of this exists in production (`NODE_ENV=production`): no store, no
tracing, no snapshots, no `/api/mastra` — the app stays stateless, and
nothing a visitor generates is written anywhere.

## Scripts

- `npm run dev` — development server.
- `npm run studio` — Mastra Studio (local; needs `npm run dev` running).
- `npm run build` / `npm start` — production build and server.
- `npm run check` — self-checks for the outline review, the heading filter,
  the dossier and the computed boxes.
- `npx eslint .` — lint.
- `npx tsc --noEmit` — typecheck (after `next build` or `next dev` has run
  once; `.next/types` is generated by it).

## Docker

Built and run via the repo-root `docker-compose.yml`, which reads
`web/.env`.
