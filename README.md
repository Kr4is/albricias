# ¡Albricias!

A self-serve vintage newspaper generator: type a GitHub username, pick a
period (daily/weekly/monthly), bring your own LLM API key, and get a
one-off broadsheet front page of that user's public activity — commits,
pull requests, releases, stars — written up in the voice of an early
20th-century newsroom.

Nothing is persisted. No accounts, no database, no saved editions — every
generation is a single request, and the LLM key you provide is used only for
that call.

The app lives under [`web/`](web/): Next.js (App Router) + React + TypeScript,
with [Mastra](https://mastra.ai) agents/workflows for the generation
pipeline.

## Features

- **Any public GitHub user** — no login, no OAuth, just a username.
- **Daily, weekly, or monthly** front pages.
- **Bring your own AI** — OpenAI, Google Gemini, a local Ollama, or any
  OpenAI-compatible endpoint (e.g. a LiteLLM proxy). The key travels only
  for the duration of one request.
- **Vintage design** — six rotating front-page layout variants, unchanged
  from the original single-tenant version.

## Getting started

See [`web/README.md`](web/README.md) for setup and running the app locally.
The only environment variable this app reads is `GITHUB_TOKEN` — a
server-held token used for every visitor's read-only GitHub activity lookup.

## Docker

```bash
docker compose up --build
```

The app is available at [http://localhost:3000](http://localhost:3000).

## Project Structure

```
albricias/
├── web/                    Next.js/TypeScript app
│   ├── src/app/            Routes: landing (/), generator (/app), API (/api/generate)
│   ├── src/components/     React components, incl. the 6 vintage front-page layouts
│   ├── src/lib/            GitHub fetch, period math, markdown/chart rendering
│   └── src/mastra/         Mastra agents & the period-post generation workflow
├── docker-compose.yml
└── .env.example
```
