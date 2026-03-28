"""AI-assisted article generation for Albricias.

Uses the OpenAI API to transform raw GitHub activity into vintage-style
newspaper articles grouped thematically.

Usage:
    articles = generate_edition_draft(edition_id, openai_api_key)
"""

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

CATEGORIES = ["Open Source", "Project Updates", "Community", "Technology", "General"]

EVENT_CATEGORY_MAP = {
    "commit": "Open Source",
    "pr": "Open Source",
    "issue": "Community",
    "release": "Project Updates",
    "star": "General",
}


def _group_activities(activities: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}
    for act in activities:
        cat = EVENT_CATEGORY_MAP.get(act.get("event_type", ""), "General")
        groups[cat].append(act)
    return {k: v for k, v in groups.items() if v}


def _summarise_group(group: list[dict]) -> str:
    lines = []
    for act in group[:20]:
        ts = ""
        if act.get("timestamp") and isinstance(act["timestamp"], datetime.datetime):
            ts = act["timestamp"].strftime("%b %d")
        elif isinstance(act.get("timestamp"), str):
            ts = act["timestamp"][:10]
        lines.append(
            f"- [{act.get('event_type', '?')}] {act.get('repo', '')}: "
            f"{act.get('title', '')} ({ts}) {act.get('url', '')}"
        )
    return "\n".join(lines)


def _parse_ai_response(raw: str, fallback_headline: str) -> tuple[str, str]:
    """Extract headline and body from an LLM response."""
    lines = raw.strip().split("\n")
    headline = ""
    body_lines: list[str] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("# "):
            headline = stripped[2:].strip()
            body_lines = lines[i + 1 :]
            break
    if not headline:
        headline = fallback_headline
        body_lines = lines
    body = "\n".join(body_lines).strip() or raw.strip()
    return headline, body


def generate_edition_draft(edition_id: int, api_key: str) -> list[Any]:
    """Generate AI article drafts for all GitHub activity in an edition.

    Saves new Article records to the database and returns them.
    """
    from app.extensions import db
    from app.models import Article, GitHubActivity, Edition

    activities = GitHubActivity.query.filter_by(edition_id=edition_id).all()
    if not activities:
        return []

    act_dicts = [
        {
            "event_type": ga.event_type,
            "repo": ga.repo,
            "title": ga.title,
            "url": ga.url,
            "timestamp": ga.timestamp,
        }
        for ga in activities
    ]

    groups = _group_activities(act_dicts)
    edition = db.session.get(Edition, edition_id)
    month_year = edition.date if edition else "this month"
    client = OpenAI(api_key=api_key)
    created: list[Article] = []

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
            print(f"[ai_writer] OpenAI call failed for '{category}': {exc}")
            continue

        fallback = f"{category} Dispatch — {month_year}"
        headline, body = _parse_ai_response(raw_content, fallback)

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
            date=(
                datetime.date(edition.year, edition.month, 1)
                if edition
                else datetime.date.today()
            ),
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
        created.append(article)

    return created


def regenerate_article(article: Any, api_key: str) -> None:
    """Re-run AI generation for a single article.

    Updates title, content, and source_data in place.
    The caller is responsible for db.session.commit().
    """
    source = article.get_source_data()
    original_prompt = source.get("prompt") or (
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
    headline, body = _parse_ai_response(raw_content, article.title)

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
