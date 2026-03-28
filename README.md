# Albricias

A vintage newspaper-style web application built with Flask. Albricias is a monthly personal digest — editions are generated with AI assistance from GitHub activity, then previewed, edited, and published through an admin interface.

## Features

- **Monthly Editions**: Each edition groups articles by month and year, with a vintage broadsheet layout.
- **AI-Assisted Generation**: Fetches GitHub activity via the GitHub API and uses OpenAI to draft articles in a classic newspaper voice.
- **Admin Workflow**: Draft → Preview → Edit → Publish, all through a browser-based admin dashboard.
- **Archive**: Browse all published editions by year with pagination.
- **Vintage Design**: Styled to resemble a traditional printed newspaper, with five rotating layout variants.

## Prerequisites

- Python 3.11 or higher
- [uv](https://github.com/astral-sh/uv) package manager

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd albricias
   ```

2. **Install dependencies:**
   ```bash
   uv sync
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and set at minimum:
   #   SECRET_KEY, ADMIN_PASSWORD
   # Optional (for AI generation):
   #   GITHUB_TOKEN, GITHUB_USERNAME, OPENAI_API_KEY
   ```

## Running the Application

```bash
FLASK_APP=wsgi.py uv run flask run
```

Navigate to [http://127.0.0.1:5000](http://127.0.0.1:5000).

The database (`albricias.db`) is created automatically on first run.

## Running with Gunicorn (production)

```bash
uv run gunicorn --config gunicorn_config.py wsgi:application
```

## Docker

```bash
docker compose up --build
```

The app is available at [http://localhost:8000](http://localhost:8000).

## Project Structure

```
albricias/
├── app/                    Flask application package
│   ├── __init__.py         create_app() factory
│   ├── config.py           Config class (env vars)
│   ├── extensions.py       SQLAlchemy instance, template filters
│   ├── auth.py             login_required / require_api_token decorators
│   ├── helpers.py          slugify, media upload, layout helpers
│   ├── models/             Edition, Article, GitHubActivity models
│   ├── routes/             Blueprints: public, admin, compose, api
│   ├── services/           GitHub API + OpenAI integrations
│   ├── templates/          Jinja2 HTML templates
│   └── static/             CSS, images, and uploaded media
├── wsgi.py                 Entry point for flask run and gunicorn
├── gunicorn_config.py      Gunicorn worker/timeout settings
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
└── .env.example
```

## Admin Access

Visit `/login` and enter the password set in `ADMIN_PASSWORD` (default: `admin`). The admin dashboard is at `/admin/editions`.
