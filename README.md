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

See [`web/README.md`](web/README.md) for setup, environment variables, and
running the app locally.

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

Visit `/login` and enter the password set in `ADMIN_PASSWORD` (default:
`admin`). The admin dashboard is at `/admin/editions`.
