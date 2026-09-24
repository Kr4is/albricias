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
with a [Mastra](https://mastra.ai) workflow and agents for the generation
pipeline — inspectable locally in Mastra Studio (`npm run mastra`).

## Features

- **Any public GitHub user** — no login, no OAuth, just a username.
- **Daily, weekly, or monthly** front pages.
- **Bring your own AI** — OpenAI, Google Gemini, or any OpenAI-compatible
  gateway (LiteLLM, Ollama, vLLM…). The key travels only for the duration
  of one request.
- **Real material** — commit messages, pull requests and their state,
  release notes, issues, and what every repo touched or starred actually
  is, with each repo's GitHub card as its picture.
- **Vintage design** — six front-page layouts whose columns always end on
  the same line; export the page as a PNG to copy, download or share.

## Getting started

See [`web/README.md`](web/README.md) for setup and running the app locally.
The one environment variable the app needs is `GITHUB_TOKEN` (in
`web/.env`) — a server-held token used for every visitor's read-only
GitHub activity lookup. The rest of `web/.env.example` is local-only
Mastra Studio configuration.

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
│   ├── src/mastra/         Mastra agents & the front-page generation workflow
│   └── .env.example
└── docker-compose.yml
```
