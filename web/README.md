# Albricias (Next.js rewrite)

The new Next.js/TypeScript rewrite of Albricias — React (App Router), Prisma
(SQLite), and [Mastra](https://mastra.ai) agents/workflows for AI-assisted
article generation. See the repo-root `README.md` for how this relates to the
legacy Flask app it is replacing.

## Setup

```bash
npm run setup   # installs deps, creates .env if missing, runs migrations
npm run dev
```

(Equivalent manual steps, if you'd rather run them yourself:
`npm install && cp .env.example .env && npx prisma generate && npx prisma migrate deploy`.
`DATABASE_URL` is the only variable you must set, and `.env.example` already
has a working default for local SQLite.)

If you ever delete `dev.db` by hand, re-run `npx prisma migrate deploy` (or
`npm run setup`) before `npm run dev` — starting the app against a missing or
freshly-recreated `dev.db` with no migrations applied fails at boot with
`The table \`main.settings\` does not exist`.

Open [http://localhost:3000](http://localhost:3000). On first run, with no
admin password stored yet, you're shown a one-time `/setup` wizard instead of
`/login` — it creates a DB-stored admin password (encrypted at rest,
alongside an auto-generated session-signing secret) and logs you in. After
that, dashboard is at `/admin/editions`.

Every other credential — the OpenAI key, GitHub token, Spotify/X/Google OAuth
app IDs, SMTP settings, branding, Alexandria — is configurable **only** from
**`/admin/settings`** once logged in. There is no env-var fallback for any of
these: `DATABASE_URL` is the one thing `.env` carries. Saving a value at
`/admin/settings` takes effect immediately, no server restart required.
Values marked as secrets (API keys, OAuth client secrets, the SMTP password)
are encrypted at rest and never re-displayed in plaintext — leave their
field blank when saving a form to keep the current value.

You can generate an edition (`/admin/editions` → "Generate with AI") right
after `/setup` with **zero credentials configured** — every source is
optional and skipped gracefully with a warning if it's not set up, so you
always get a usable draft edition to test against. From there, add
credentials incrementally in whatever order fits how much setup each one
needs:

| Effort level | Services | What it takes |
| --- | --- | --- |
| **0 — nothing** | (default) | Generate right away; sources are skipped with warnings, no AI articles until a provider is added. |
| **0 — free, runs on your machine** | Ollama | Install [Ollama](https://ollama.com), run `ollama serve`, pull an **instruct** model (e.g. `ollama pull qwen2.5:0.5b-instruct` or `ollama pull llama3.1`), then at `/admin/settings` → AI set Active Provider to "Ollama" and Ollama Model to the model you pulled (Base URL defaults to `http://localhost:11434/v1`). No API key, no cost, no external account. **Avoid "thinking"-mode models** (e.g. plain `qwen3`/`qwen3.5` without an `-instruct` suffix) — this app's 800-token generation budget is often too small for them to finish reasoning and still emit an article, producing empty output. |
| **1 — point at a proxy you already run** | LiteLLM *(default Active Provider)* | Any OpenAI-compatible endpoint — e.g. a [LiteLLM](https://www.litellm.ai/) proxy in front of a self-hosted model. At `/admin/settings` → AI, Active Provider defaults to "LiteLLM"; set LiteLLM Base URL, LiteLLM API Key, and LiteLLM Model. Unlike Ollama there's no default base URL — it points at wherever your proxy runs — so all three fields are required before generation will use it. |
| **1 — paste a key/token** | OpenAI, Google Gemini (has a free tier), GitHub | No external app registration. Get an API key / a personal access token, set it at `/admin/settings`, and for AI pick it as the Active Provider. GitHub is the richest activity source; OpenAI/Gemini draft the articles. |
| **2 — register an OAuth app** | Spotify, Google Calendar, X/Twitter | Requires creating an OAuth app in that provider's developer console first, then connecting your account from the admin UI (`/admin/spotify`, `/admin/calendar`, `/admin/social/twitter`). Google Calendar has a full walkthrough at [`docs/google-calendar-setup.md`](docs/google-calendar-setup.md); Spotify/X follow the same shape (client id/secret + redirect URI). |
| **2b — paste a token, no OAuth** | Bluesky, Mastodon (social distribution, not generation sources) | Identifier/instance URL + app password or access token, entered directly at `/admin/social`. |
| **3 — run a separate service** | Alexandria | Only usable if you're also running the separate Alexandria project locally (a personal reading-library app, not part of this repo) and point `integrations.alexandria.apiUrl` at it. Otherwise leave it unset — it's skipped like any other optional source. |

**AI provider note:** the "AI" category in `/admin/settings` lets you pick one
active provider (LiteLLM, OpenAI, Gemini, or Ollama) for article drafting,
rankings, and social copy — switching takes effect immediately, no restart.
LiteLLM is the default on a fresh instance (it's the option most likely to
already be free to call, pointing at a proxy you run yourself), but it still
needs its Base URL, API Key, and Model set before any AI generation will run
— with nothing configured for any provider, generation degrades gracefully
and just skips the AI-writing steps. Audio transcription (Whisper, used when
generating an article from an uploaded recording) always uses the OpenAI key
specifically, regardless of which provider is active, since it's a separate
capability none of the others replace.

## How Generation Works

Clicking "Generate with AI" (or the cadence-driven cron scheduler) runs
`populateEditionDraft` (`web/src/lib/generation/index.ts`), which executes
the following phases in order for the edition's period. Every phase is
individually try/caught and degrades gracefully — a missing credential or a
failed source logs a warning and the pipeline moves on rather than aborting:

1. **GitHub fetch** — pulls commits/PRs/issues/reviews/stars via the GitHub
   API for the configured username, if a token and username are set.
2. **GitHub stats bank** — pure arithmetic over the GitHub activity just
   saved (busiest days, commit/PR/issue/release/star breakdown, most-used
   languages, etc.). Needs no AI provider, so it always runs when GitHub
   fetch produced anything.
3. **GitHub topic candidates** — scores heuristic "topic" ideas (a release,
   a bugfix story, a new language, a contribution streak, ...) off the stats
   bank just computed. Also needs no AI provider.
4. **Blog RSS fetch** — pulls posts from the configured blog feed, if set.
5. **Spotify fetch** — pulls listening activity for the period, if Spotify
   is connected (refreshing the access token first if it expired).
6. **Alexandria fetch** — pulls reading activity from a separately-run
   Alexandria instance, if `integrations.alexandria.apiUrl` is set.
7. **AI generation (chronicle)** — if an AI provider is configured and at
   least one activity was fetched, drafts the newspaper-voice articles for
   each source bucket (GitHub, blog, Spotify, Alexandria).
8. **Activity ranking** — writes one "busiest day(s) / most active repo"
   style ranking article off the GitHub activity, if there's anything to
   rank.
9. **Calendar ranking** — same idea for Google Calendar events, if Calendar
   is connected and has events for the period.
10. **Topic-candidate article generation** — auto-writes one article per
    topic candidate from phase 3 whose score clears
    `TOPIC_CANDIDATE_AUTO_GENERATE_THRESHOLD`, with no admin action needed.
11. **Cross-source synthesis (the "Compendium")** — runs last, on purpose:
    it reads everything the phases above persisted (chronicle articles,
    rankings, marked topic-candidate articles, the raw stats bank) and
    writes one front-page editorial that ties the period together, placed
    as the edition's lead article. It only fires when there's enough
    cross-source material to be worth synthesizing (at least 3 bucketed
    articles across at least 2 distinct categories); otherwise it skips
    gracefully like every other phase. See
    `web/src/lib/synthesis/index.ts` for the full contract.

A manual "Regenerate" action exists for most individual articles/phases from
the edit page, independent of the full pipeline above.

## GitHub Insights

Two of the pipeline phases above (GitHub stats bank and topic candidates)
feed the "GitHub Insights" section of `/admin/editions/[id]/edit`, split
into two parts:

- **Stats Bank** — the raw computed numbers (busiest days, commit/PR/issue
  breakdown, languages, starred repos, etc.), shown read-only per section.
  You can mark/unmark individual metrics, but this is currently a **pure
  annotation** — starring a stats-bank metric has no effect on article
  generation or visibility today.
- **Topic Candidates** — the heuristic-scored ideas from phase 3 above, each
  shown with its score and (if generated) linked to the article phase 10
  auto-wrote for it. Unmarking a topic candidate **hides** the article it
  produced (without deleting it) and drops it from what the Compendium
  synthesis phase digests; marking it back shows it again. Regenerating the
  Compendium after a curation change is how the change reaches the
  already-written front-page article.

The auto-generation score threshold
(`TOPIC_CANDIDATE_AUTO_GENERATE_THRESHOLD` in `generation/index.ts`) is
currently **35** out of a 100-point theoretical max. The code's own comment
calls this an evidence-based starting point, **not a final value** — it may
change as more real editions go through scoring.

## Scripts

- `npm run dev` — development server.
- `npm run build` / `npm start` — production build and server.
- `npx tsc --noEmit` — typecheck (run `next build` or `next dev` at least once
  first; `.next/types` is generated by the build).
- `npx eslint src` — lint.
- `npx tsx scripts/migrate-from-flask.ts --help` — one-off migration of data
  from the legacy Flask `albricias.db` into this app's Prisma database. See
  the script's header comment for full usage and safety notes.

## Docker

Built and run via the repo-root `docker-compose.yml` (`web-next` service),
alongside the legacy Flask app during the migration period.

## Development / Troubleshooting

**After any `prisma/schema.prisma` change, fully kill and restart
`npm run dev` — don't rely on hot reload.** The workflow is:

```bash
npx prisma migrate dev
npx prisma generate
```

then stop the running dev server and start it again with `npm run dev`.

Why: the shared `PrismaClient` (`web/src/lib/prisma.ts`) is cached on
`globalThis` specifically so that Next.js dev-mode hot reloads don't open a
new SQLite connection on every recompile. That cache survives a schema
migration — hot reload does not re-create the client — so a dev server left
running across a migration keeps using the old, now-stale client and can
silently serve against the previous schema (or throw confusing "column does
not exist" errors) instead of picking up the new one. A full process
restart is what clears `globalThis.prisma` and forces a fresh client.
