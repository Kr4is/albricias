# Albricias (Next.js rewrite)

The new Next.js/TypeScript rewrite of Albricias — React (App Router), Prisma
(SQLite), and [Mastra](https://mastra.ai) agents/workflows for AI-assisted
article generation. See the repo-root `README.md` and
`.omc/plans/react-mastra-rewrite.md` for how this relates to the legacy Flask
app it is replacing.

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
| **1 — paste a key/token** | OpenAI, Google Gemini (has a free tier), GitHub | No external app registration. Get an API key / a personal access token, set it at `/admin/settings`, and for AI pick it as the Active Provider. GitHub is the richest activity source; OpenAI/Gemini draft the articles. |
| **2 — register an OAuth app** | Spotify, Google Calendar, X/Twitter | Requires creating an OAuth app in that provider's developer console first, then connecting your account from the admin UI (`/admin/spotify`, `/admin/calendar`, `/admin/social/twitter`). Google Calendar has a full walkthrough at [`docs/google-calendar-setup.md`](docs/google-calendar-setup.md); Spotify/X follow the same shape (client id/secret + redirect URI). |
| **2b — paste a token, no OAuth** | Bluesky, Mastodon (social distribution, not generation sources) | Identifier/instance URL + app password or access token, entered directly at `/admin/social`. |
| **3 — run a separate service** | Alexandria | Only usable if you're also running the separate Alexandria project locally (a personal reading-library app, not part of this repo) and point `integrations.alexandria.apiUrl` at it. Otherwise leave it unset — it's skipped like any other optional source. |

**AI provider note:** the "AI" category in `/admin/settings` lets you pick one
active provider (OpenAI, Gemini, or Ollama) for article drafting, rankings,
and social copy — switching takes effect immediately, no restart. Audio
transcription (Whisper, used when generating an article from an uploaded
recording) always uses the OpenAI key specifically, regardless of which
provider is active, since it's a separate capability none of the others
replace.

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
