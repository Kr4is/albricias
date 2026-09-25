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
   **pictures** runs alongside it (`.parallel`): the real pictures each repo
   shows of itself (`src/lib/sources/repo-images.ts`) — its custom social
   preview, the screenshots, banners and diagrams in its README (badges,
   avatars, sponsor logos and SVGs left out; alt text kept as the caption),
   or its website's preview image. Never GitHub's generated card.
3. **review** — no model: the outline checked against the dossier and
   fixed in code (`reviewOutline`). Repo names are resolved (typos
   included) or dropped, kinds made to fit their repos, the stars get one
   section at most and never the longest, the lead is the biggest piece of
   work, the section count stays in range, and forgotten work joins a
   round-up. Every change is listed in the step's `notes` (visible in
   Studio).
4. **illustrate** — no model: each section's picture (each repo's at most
   once) and charts, computed from the dossier by the chart desk
   (`src/lib/generation/charts.ts`) and chosen by kind — a 24-hour rose and
   the week-by-week arc for an overview, a feature's commits day by day
   stacked by kind of work, a round-up's repos side by side, how big the
   starred projects are. The stars and numbers boxes are built here too, as
   structured blocks (`src/lib/article-blocks.ts`): one card per star, the
   numbers as facts plus the mix of work.
5. **write-section** (`ALBRICIAS_SECTION_CONCURRENCY` at a time, 2 by
   default) — the `correspondent` agent writes prose only, from only its
   slice of the dossier: the overview for an `overview`, the stars for a
   reading list, otherwise its repos over its days, plus one line on
   everything else.
6. **assemble** — the boxes after the written sections (the stars box left
   out when a reading list already covers them).

Every picture is served through the app's own `/api/image`
(`src/app/api/image/route.ts`): the page — and its PNG export — can only
use same-origin images, and a README's hosts rarely send CORS headers. The
proxy only fetches URLs the server signed (HMAC keyed on
`IMAGE_PROXY_SECRET`, or else derived from `GITHUB_TOKEN`), only over
public `https` (`src/lib/sources/safe-fetch.ts` refuses private and local
addresses, on every redirect), and only raster images. Nothing is stored.

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

Every run is also **scored** as it happens (`src/mastra/scorers.ts`,
Mastra's evals), and the scores show in Studio next to each step and under
*Scorers*. They're code, not a model grading a model — free, and exact about
what they found (`src/lib/generation/checks.ts`):

- `figures-grounded` — the numbers in a section's prose (digits or words)
  appear in the material it was given;
- `repos-grounded` — so do the `owner/name` repositories it names;
- `length-fit` — its length against its tier's word band;
- `house-style` — no "the user", no naming the material or the kind of
  section, no echoed heading, no table or chart markup, no worked-out
  intervals ("two days later");
- `outline-clean` (on `review`) — how little the review had to fix.

Change a prompt or a model, generate again, and compare the scores across
runs. The Mastra instance lives for the whole dev server, so after editing
the workflow, its agents or its scorers, restart `npm run dev`.

To run the workflow from Studio itself, give it a model in `.env`
(`ALBRICIAS_LLM_*`, see `.env.example`); runs from the app always use the
visitor's own.

None of this exists in production (`NODE_ENV=production`): no store, no
tracing, no snapshots, no scorers, no `/api/mastra` — the app stays stateless, and
nothing a visitor generates is written anywhere.

## Scripts

- `npm run dev` — development server.
- `npm run studio` — Mastra Studio (local; needs `npm run dev` running).
- `npm run build` / `npm start` — production build and server.
- `npm run check` — self-checks for the outline review, the heading filter,
  the dossier, the chart desk and boxes, finding pictures, and the scorers.
- `npx eslint .` — lint.
- `npx tsc --noEmit` — typecheck (after `next build` or `next dev` has run
  once; `.next/types` is generated by it).

## Docker

Built and run via the repo-root `docker-compose.yml`, which reads
`web/.env`.
