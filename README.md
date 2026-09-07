# Albricias

A vintage newspaper-style web application. Albricias is a personal digest —
editions are generated with AI assistance from your GitHub activity and blog
posts, then previewed, edited, and published through an admin interface.

The app lives under [`web/`](web/): Next.js (App Router) + React + TypeScript,
Prisma (SQLite), and [Mastra](https://mastra.ai) agents/workflows for the
generation pipeline.

## Features

- **Configurable cadence**: generate editions weekly or monthly, set globally
  in the admin panel.
- **AI-assisted generation**: fetches GitHub activity and blog RSS posts, and
  uses an AI agent to draft articles in a classic newspaper voice.
- **Admin workflow**: Draft → Preview → Edit → Publish, all through a
  browser-based admin dashboard.
- **Archive**: browse all published editions by year with pagination.
- **Vintage design**: styled to resemble a traditional printed newspaper,
  with five rotating layout variants.
- **Spotify integration**: optional listening-activity source for editions.

## Getting started

See [`web/README.md`](web/README.md) for setup and running the app locally.
The only environment variable this app reads is `DATABASE_URL` — every
credential (admin password, OpenAI, GitHub, Spotify/X/Google, SMTP,
branding, Alexandria) is configured through the web interface itself, via
the first-run `/setup` wizard and `/admin/settings`.

## Docker

```bash
docker compose up --build
```

The app is available at [http://localhost:3000](http://localhost:3000). It
reads/writes its SQLite database and uploaded media under the `./instance`
and `./web/public/uploads` volumes.

## Project Structure

```
albricias/
├── web/                    Next.js/TypeScript/Prisma/Mastra app
│   ├── src/app/            Routes (public site + admin)
│   ├── src/components/     React components, incl. the 5 vintage layouts
│   ├── src/lib/            Sources, generation, session, Prisma client
│   ├── src/mastra/         Mastra agents & workflows
│   └── prisma/             Database schema & migrations
├── docker-compose.yml
└── .env.example
```

## Admin Access

On first run, visiting the app shows a one-time `/setup` wizard instead of
`/login` — it creates a DB-stored admin password (there is no default
password and no `ADMIN_PASSWORD` env var). After that, `/login` works
normally and the admin dashboard is at `/admin/editions`.
