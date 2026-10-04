# ¡Albricias!

A self-serve vintage newspaper generator: type a GitHub username, pick a
period, bring your own LLM API key, and get a one-off broadsheet front page
of that user's activity — commits, pull requests, releases, stars — written
up in the voice of an early 20th-century newsroom.

Nothing is persisted. No accounts, no database, no saved editions — every
generation is a single request, and the keys you provide are used only for
that call.

**[Architecture diagram](docs/architecture.html)** — open it in a browser.

## Features

- **Any GitHub user, no login.** Public activity needs nothing but a
  username. Private repositories are an explicit opt-in with a token of your
  own.
- **Weekly, monthly or quarterly** editions, always over the last *complete*
  period (monthly is the default) — on the 4th, "monthly" is last month, not
  four days of this one.
- **Bring your own AI** — OpenAI, Google Gemini, or any OpenAI-compatible
  gateway (LiteLLM, Ollama, vLLM…).
- **Real material** — commit messages, pull requests and their state,
  release notes, issues, and what every repo touched or starred actually is,
  with each repo's own pictures and charts computed from the data.
- **Vintage design** — six front-page layouts, all built from balanced column
  flows so every column ends on the same line; export the page as a PNG to
  copy, download or share.
- **A four-step setup** (byline → sources → newsroom → press) that remembers
  everything in your browser.

## Quick start

```bash
cd web
npm run setup     # installs dependencies, creates .env, enables the git hooks
npm run dev       # http://localhost:3000  (the generator is at /app)
```

Or with Docker, from the repo root:

```bash
docker compose up --build   # http://localhost:3000
```

You need an API key for your LLM provider; the app asks for it in the form.

## Using it

1. **Byline** — the GitHub username and the period.
2. **Sources** — *Public activity only* (default, nothing to paste), or
   *Include my private activity*, which asks for a GitHub token: a classic
   token with the `repo` scope, or a fine-grained one with read access to
   your repositories' contents, issues and pull requests. The token must
   belong to the username on the first step; private repository names and
   commit messages go to your AI provider and appear on the page.
3. **Newsroom** — provider, API key, optional model; a gateway also takes a
   base URL and a *Thinking* choice (see [`web/README.md`](web/README.md)).
4. **Press** — a summary and **Print My Edition**.

Everything you enter — including the API key and token — is remembered in
this browser's `localStorage` only, never on a server. A returning visitor
with a complete form lands straight on the last step.

When the edition is done you can switch layout, then **Copy Image**,
**Download** or **Share** it as a PNG.

## Configuration

Set in `web/.env` (copy of [`web/.env.example`](web/.env.example)); all
optional.

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Server-side token for **public** editions (no scopes needed). Without one, GitHub's unauthenticated limits apply (10 requests/min on search) — fine for occasional use. Never used for private activity. |
| `IMAGE_PROXY_SECRET` | Key the image proxy signs picture URLs with. Unset: derived from `GITHUB_TOKEN`, or random at boot. |
| `ALBRICIAS_SECTION_CONCURRENCY` | Sections written at once (default 2). `1` for gateways that drop concurrent connections. |
| `ALBRICIAS_PROMPT_CHARS` | Most characters of GitHub material a model call reads (default 60 000, about 15k tokens); busier accounts have their least informative commits thinned to fit. Lower it for small-context models. |
| `ALBRICIAS_LLM_IDLE_SECONDS` | How long an AI call may go without producing a token before it is stopped with an error (default 240, minimum 30). Raise it for slow thinking models. |
| `ALBRICIAS_LLM_*` | Model used by Mastra Studio runs (local development only). |
| `ALBRICIAS_SCORERS` | Score runs in Studio (`1` = every run, `0.2` = 20 %). Local only. |

## How it works

See the [interactive architecture diagram](docs/architecture.html).

`POST /api/generate` validates the form and runs the `front-page` Mastra
workflow, relaying its steps as Server-Sent Events: **gather** the GitHub
activity into a typed dossier, **plan** the page (an LLM outline, then fixed
in code), find each repo's **pictures**, **illustrate** with charts computed
from the dossier, **write** each section from only its slice of the data,
and **assemble**. The browser renders the stream in one of six layouts,
measures the page and levels its columns, and can export it as a PNG.
Details, prompts and the Studio workflow are in
[`web/README.md`](web/README.md).

## Development

```bash
cd web
npm run verify        # lint + typecheck + every self-check (what the pre-commit hook runs)
npm run check:layouts # renders every layout in headless Chromium and fails on holes in the page
npm run build         # production build
```

- **Pre-commit hook** — `npm install` (the `prepare` script) points git at
  [`.githooks/`](.githooks/), which runs `npm run verify` before each commit.
  Skip once with `git commit --no-verify`.
- **CI** — [`ci.yml`](.github/workflows/ci.yml) runs lint, typecheck, the
  self-checks and the build on every pull request, plus the layout check in
  Chromium. Merging to `master` builds and publishes the Docker image.
- **Self-checks** — `web/scripts/check-*.ts` are plain `assert` scripts for
  the logic with no LLM call to exercise it (period maths, outline review,
  dossier, charts, picture finding, scorers, the setup wizard's rules).
- **Layout fixtures** — with `npm run dev` running, `/dev/layouts?layout=1&n=6`
  renders a layout on made-up articles (404 in production).
  `npx tsx scripts/export-fixture.ts 1 6 out.png` runs the real PNG export on
  one (`BROWSER=firefox` for Firefox); `check:layouts` needs
  `npx playwright-core install chromium`, or `CHROMIUM_PATH` pointing at one.

## Which version is running

The page footer shows the app version and the commit it was built from
(linked to GitHub), and `GET /api/version` returns the same as JSON:
`curl https://<your-host>/api/version`. CI passes the commit to the Docker
build (`GIT_SHA`); a local build shows `dev`.

## Project structure

```
albricias/
├── web/                    Next.js / TypeScript app
│   ├── src/app/            Routes: landing (/), generator (/app), API, /dev/layouts
│   ├── src/components/     Setup wizard, edition page, the six layouts, export
│   ├── src/lib/            GitHub source, period maths, dossier/charts, layout balancing
│   ├── src/mastra/         Mastra agents & the front-page workflow
│   └── scripts/            Self-checks and layout/export tooling
├── docs/                   Architecture diagram
├── .githooks/              Pre-commit hook
├── .github/workflows/      CI and Docker image publishing
└── docker-compose.yml
```

## Privacy

The visitor's LLM key and (for private editions) GitHub token travel in one
request's context and are gone when it ends; nothing is written to a
database or log. Public editions never use a visitor's token. The only
persistence is the visitor's own browser.
