"""AI-assisted article generation for Albricias.

Uses the OpenAI API to transform raw GitHub activity into vintage-style
newspaper articles grouped thematically.

Usage:
    articles = generate_edition_draft(edition_id, openai_api_key)
"""

import json
import datetime
from typing import Any

try:
    from openai import OpenAI
except ImportError:
    raise ImportError("openai is required: uv add openai")


NEWSPAPER_PERSONA = (
    "You are the chief editor of ¡Albricias!, a whimsical vintage newspaper "
    "published in the style of early 20th-century broadsheets. "
    "Your writing is eloquent, slightly dramatic, and uses the grandiloquent "
    "journalistic voice of a bygone era — yet the content is accurate and grounded "
    "in the actual activity provided. "
    "Use markdown for formatting. Keep each article between 150 and 350 words."
)

CATEGORIES = [
    "Open Source",
    "Project Updates",
    "Community",
    "Technology",
    "General",
]

# Map GitHub event types to newspaper categories
EVENT_CATEGORY_MAP = {
    "commit": "Open Source",
    "pr": "Open Source",
    "issue": "Community",
    "release": "Project Updates",
    "star": "General",
}


def _group_activities(activities: list[dict]) -> dict[str, list[dict]]:
    """Group activity dicts by category."""
    groups: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}
    for act in activities:
        cat = EVENT_CATEGORY_MAP.get(act.get("event_type", ""), "General")
        groups[cat].append(act)
    return {k: v for k, v in groups.items() if v}


def _summarise_group(group: list[dict]) -> str:
    """Create a brief bullet-point summary of activities for the prompt."""
    lines = []
    for act in group[:20]:  # Cap to avoid token overflow
        ts = ""
        if act.get("timestamp") and isinstance(act["timestamp"], datetime.datetime):
            ts = act["timestamp"].strftime("%b %d")
        elif isinstance(act.get("timestamp"), str):
            ts = act["timestamp"][:10]
        repo = act.get("repo", "")
        title = act.get("title", "")
        url = act.get("url", "")
        lines.append(f"- [{act.get('event_type','?')}] {repo}: {title} ({ts}) {url}")
    return "\n".join(lines)


def generate_edition_draft(edition_id: int, api_key: str) -> list[Any]:
    """Generate AI article drafts for all GitHub activity in an edition.

    Saves new Article records to the database and returns them.
    """
    from models import db, Article, GitHubActivity

    activities = GitHubActivity.query.filter_by(edition_id=edition_id).all()
    if not activities:
        return []

    # Convert to plain dicts for processing
    act_dicts = []
    for ga in activities:
        act_dicts.append(
            {
                "event_type": ga.event_type,
                "repo": ga.repo,
                "title": ga.title,
                "url": ga.url,
                "timestamp": ga.timestamp,
            }
        )

    groups = _group_activities(act_dicts)
    client = OpenAI(api_key=api_key)
    created_articles: list[Article] = []

    # Determine the edition month/year for context
    from models import Edition
    edition = db.session.get(Edition, edition_id)
    month_year = edition.date if edition else "this month"

    for category, group_acts in groups.items():
        summary = _summarise_group(group_acts)
        prompt = (
            f"Write a newspaper article for the '{category}' section of the "
            f"{month_year} edition of ¡Albricias!.\n\n"
            f"Base it on the following activity:\n{summary}\n\n"
            f"The article should be in the vintage journalistic style described. "
            f"Give it a compelling headline (as a markdown H1), then the body text. "
            f"Do not include a byline or date — those are added separately."
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": NEWSPAPER_PERSONA},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.8,
                max_tokens=600,
            )
            raw_content = response.choices[0].message.content or ""
        except Exception as exc:
            print(f"[ai_writer] OpenAI call failed for category '{category}': {exc}")
            continue

        # Parse headline from first H1 line
        lines = raw_content.strip().split("\n")
        headline = ""
        body_lines = []
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("# "):
                headline = stripped[2:].strip()
                body_lines = lines[i + 1:]
                break
        if not headline:
            headline = f"{category} Dispatch — {month_year}"
            body_lines = lines

        body = "\n".join(body_lines).strip()
        if not body:
            body = raw_content.strip()

        # Determine order (after any existing articles)
        from sqlalchemy import func
        max_order = (
            db.session.query(func.max(Article.order))
            .filter_by(edition_id=edition_id)
            .scalar()
        )

        article = Article(
            edition_id=edition_id,
            title=headline,
            content=body,
            category=category,
            author="The Albricias Correspondent",
            deck=body[0] if body else "A",
            order=(max_order or 0) + 1,
            date=datetime.date(edition.year, edition.month, 1) if edition else datetime.date.today(),
            source_type="ai_generated",
        )
        article.set_source_data(
            {
                "prompt": prompt,
                "response": raw_content,
                "model": "gpt-4o-mini",
                "activity_count": len(group_acts),
            }
        )
        db.session.add(article)
        db.session.flush()
        created_articles.append(article)

    return created_articles


def regenerate_article(article: Any, api_key: str) -> None:
    """Re-run AI generation for a single article using its stored source data.

    Updates article.title, article.content, and article.source_data in place.
    The caller is responsible for calling db.session.commit().
    """
    from models import db

    source = article.get_source_data()
    original_prompt = source.get("prompt")

    if not original_prompt:
        # Fallback: build a minimal prompt from the article content
        original_prompt = (
            f"Rewrite and improve this vintage newspaper article titled "
            f"'{article.title}':\n\n{article.content}"
        )

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": NEWSPAPER_PERSONA},
            {"role": "user", "content": original_prompt},
        ],
        temperature=0.9,
        max_tokens=600,
    )
    raw_content = response.choices[0].message.content or ""

    lines = raw_content.strip().split("\n")
    headline = ""
    body_lines = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("# "):
            headline = stripped[2:].strip()
            body_lines = lines[i + 1:]
            break
    if not headline:
        headline = article.title
        body_lines = lines

    body = "\n".join(body_lines).strip() or raw_content.strip()

    article.title = headline or article.title
    article.content = body
    article.deck = body[0] if body else "A"
    article.updated_at = datetime.datetime.utcnow()
    article.set_source_data(
        {
            **source,
            "last_regeneration_response": raw_content,
            "last_regenerated_at": datetime.datetime.utcnow().isoformat(),
        }
    )
