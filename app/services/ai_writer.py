"""AI-assisted article generation orchestrator for Albricias.

This module is the central entry point for all AI generation flows:

* :func:`generate_edition_draft` — existing pipeline: GitHub/Spotify activity
  rows → chronicle articles.  Kept for backward compatibility with admin routes.
* :func:`regenerate_article` — re-run generation for an existing AI article.
* :func:`generate_article_from_source` — new pipeline: accepts a source type
  (audio, text, notes) + generator type (reflection, interview, review, profile)
  and orchestrates the two-stage source → generator flow.
"""

from __future__ import annotations

import datetime
from typing import Any


# ---------------------------------------------------------------------------
# Public orchestrator — new assisted generation pipeline
# ---------------------------------------------------------------------------


def generate_article_from_source(
    *,
    edition_id: int,
    source_type: str,
    generator_type: str,
    api_key: str,
    # Source inputs (only the relevant one will be non-None)
    audio_file=None,
    audio_filename: str = "",
    text_input: str = "",
    # Generator options
    topic_hint: str = "",
    subject_name: str = "",
    subject_type: str = "other",
    interviewee_name: str = "",
    article_date: datetime.date | None = None,
    author: str = "The Albricias Correspondent",
) -> Any:
    """Orchestrate a source → generator pipeline and persist the resulting Article.

    Parameters
    ----------
    edition_id:
        Target edition.
    source_type:
        One of ``"audio_monologue"``, ``"audio_conversation"``, ``"text"``,
        ``"notes"``.
    generator_type:
        One of ``"reflection"``, ``"interview"``, ``"review"``, ``"profile"``.
    api_key:
        OpenAI API key.
    audio_file:
        Werkzeug ``FileStorage`` object (only when source_type starts with
        ``"audio"``).
    audio_filename:
        Original filename of the audio upload.
    text_input:
        Pasted text (used when source_type is ``"text"`` or ``"notes"``).
    topic_hint:
        Optional extra instruction passed to all generators.
    subject_name:
        Name of the subject (review / profile generators).
    subject_type:
        Subject category for review generator.
    interviewee_name:
        Name of the interviewee (interview generator).
    article_date:
        Date to stamp on the article; defaults to the first of the edition month.
    author:
        By-line for the article.

    Returns
    -------
    Article
        The newly created and flushed Article record.
    """
    from app.extensions import db
    from app.models import Article, Edition
    from sqlalchemy import func

    # ------------------------------------------------------------------
    # 1. Process source → get normalized text
    # ------------------------------------------------------------------
    if source_type in ("audio_monologue", "audio_conversation"):
        from app.services.sources.audio import process as audio_process

        mode = "monologue" if source_type == "audio_monologue" else "conversation"
        source_result = audio_process(
            file_obj=audio_file,
            filename=audio_filename,
            mode=mode,
            api_key=api_key,
        )
    elif source_type in ("text", "notes"):
        from app.services.sources.text import process_text

        source_result = process_text(raw=text_input, source_type=source_type)
    else:
        raise ValueError(f"Unknown source_type: {source_type!r}")

    # ------------------------------------------------------------------
    # 2. Generate article → get structured result
    # ------------------------------------------------------------------
    if generator_type == "reflection":
        from app.services.generators.reflection import generate

        result = generate(text=source_result.text, api_key=api_key, topic_hint=topic_hint)

    elif generator_type == "interview":
        from app.services.generators.interview import generate

        result = generate(
            text=source_result.text,
            api_key=api_key,
            interviewee_name=interviewee_name,
            topic_hint=topic_hint,
        )

    elif generator_type == "review":
        from app.services.generators.review import generate

        result = generate(
            text=source_result.text,
            api_key=api_key,
            subject_name=subject_name,
            subject_type=subject_type,
            topic_hint=topic_hint,
        )

    elif generator_type == "profile":
        from app.services.generators.profile import generate

        result = generate(
            text=source_result.text,
            api_key=api_key,
            subject_name=subject_name,
            topic_hint=topic_hint,
        )
    else:
        raise ValueError(f"Unknown generator_type: {generator_type!r}")

    # ------------------------------------------------------------------
    # 3. Persist Article
    # ------------------------------------------------------------------
    edition = db.session.get(Edition, edition_id)
    if article_date is None:
        article_date = (
            datetime.date(edition.year, edition.month, 1) if edition else datetime.date.today()
        )

    max_order = (
        db.session.query(func.max(Article.order)).filter_by(edition_id=edition_id).scalar()
    )

    article = Article(
        edition_id=edition_id,
        title=result.title,
        content=result.content,
        category=result.category,
        author=author,
        deck=result.content[0] if result.content else "A",
        order=(max_order or 0) + 1,
        date=article_date,
        source_type="ai_generated",
    )
    article.set_source_data(
        {
            **result.source_data,
            "source_type": source_type,
            "source_metadata": source_result.metadata,
            "transcription": source_result.text,
        }
    )
    db.session.add(article)
    db.session.flush()
    return article


# ---------------------------------------------------------------------------
# Backward-compatible edition pipeline (delegates to chronicle generator)
# ---------------------------------------------------------------------------


def generate_edition_draft(edition_id: int, api_key: str) -> list[Any]:
    """Generate AI article drafts for all service activity in an edition.

    Saves new Article records to the database and returns them.
    Delegates to :mod:`app.services.generators.chronicle`.
    """
    from app.extensions import db
    from app.models import Article, ServiceActivity, Edition
    from app.services.generators.chronicle import generate_from_activities
    from sqlalchemy import func

    activities_qs = ServiceActivity.query.filter_by(edition_id=edition_id).all()
    if not activities_qs:
        return []

    act_dicts = [
        {
            "event_type": sa.event_type,
            "repo": sa.repo,
            "title": sa.title,
            "url": sa.url,
            "timestamp": sa.timestamp,
        }
        for sa in activities_qs
    ]

    edition = db.session.get(Edition, edition_id)
    month_year = str(edition.date) if edition else "this month"

    results = generate_from_activities(
        activities=act_dicts,
        month_year=month_year,
        api_key=api_key,
    )

    created: list[Article] = []
    for result in results:
        max_order = (
            db.session.query(func.max(Article.order))
            .filter_by(edition_id=edition_id)
            .scalar()
        )
        article = Article(
            edition_id=edition_id,
            title=result.title,
            content=result.content,
            category=result.category,
            author="The Albricias Correspondent",
            deck=result.content[0] if result.content else "A",
            order=(max_order or 0) + 1,
            date=(
                datetime.date(edition.year, edition.month, 1)
                if edition
                else datetime.date.today()
            ),
            source_type="ai_generated",
        )
        article.set_source_data(result.source_data)
        db.session.add(article)
        db.session.flush()
        created.append(article)

    return created


def regenerate_article(article: Any, api_key: str) -> None:
    """Re-run AI generation for a single article.

    Updates title, content, and source_data in place.
    The caller is responsible for ``db.session.commit()``.
    """
    from app.services.generators._base import NEWSPAPER_PERSONA, call_openai, parse_response

    source = article.get_source_data()
    original_prompt = source.get("prompt") or (
        f"Rewrite and improve this vintage newspaper article titled "
        f"'{article.title}':\n\n{article.content}"
    )

    raw = call_openai(
        system=NEWSPAPER_PERSONA,
        user=original_prompt,
        api_key=api_key,
        temperature=0.9,
    )
    headline, body = parse_response(raw, article.title)

    article.title = headline or article.title
    article.content = body
    article.deck = body[0] if body else "A"
    article.updated_at = datetime.datetime.utcnow()
    article.set_source_data(
        {
            **source,
            "last_regeneration_response": raw,
            "last_regenerated_at": datetime.datetime.utcnow().isoformat(),
        }
    )
