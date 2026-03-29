"""Chronicle / Report generator — refactored from the original ai_writer.py.

Transforms ``ServiceActivity`` rows (GitHub, Spotify, etc.) into vintage
newspaper dispatches, grouped by category. This is the existing pipeline,
extracted into the new generator module structure.
"""

from __future__ import annotations

import datetime
from typing import Any

from app.services.generators import GeneratorResult
from app.services.generators._base import NEWSPAPER_PERSONA, call_openai, parse_response

CATEGORIES = [
    "Open Source",
    "Project Updates",
    "Community",
    "Technology",
    "Discoveries",
    "Culture",
    "General",
]

EVENT_CATEGORY_MAP: dict[str, str] = {
    "commit": "Open Source",
    "pr": "Open Source",
    "review": "Open Source",
    "issue": "Community",
    "release": "Project Updates",
    "repo_created": "Project Updates",
    "gist": "Technology",
    "star": "Discoveries",
    "spotify_track": "Culture",
    "spotify_artist": "Culture",
    "spotify_played": "Culture",
}

CATEGORY_PROMPTS: dict[str, str] = {
    "Open Source": (
        "Focus on the coding craftsmanship: the commits pushed, the pull requests "
        "opened and reviewed, the careful labour of the software artisan."
    ),
    "Project Updates": (
        "Celebrate the milestones: new repositories brought into the world and "
        "software releases proclaimed to the public."
    ),
    "Community": (
        "Chronicle the discourse: issues raised, questions posed, conversations "
        "had in the great bazaar of open-source collaboration."
    ),
    "Technology": (
        "Illuminate the craft: gists shared, snippets of wisdom distributed to "
        "the wider technical community."
    ),
    "Discoveries": (
        "Write a 'Repos of the Month' roundup in the style of a society column — "
        "each starred repository introduced as a remarkable new acquaintance. "
        "Include the repo name and a brief description of why it is worthy of note."
    ),
    "Culture": (
        "Write a 'Sounds of the Month' column. Report the top tracks and artists "
        "as though reviewing a concert season — grandiloquent, opinionated, and "
        "enthusiastic. List the top tracks and artists with their Spotify URLs."
    ),
    "General": (
        "Cover the miscellaneous happenings of the month with characteristic flair."
    ),
}


def _group_activities(activities: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}
    for act in activities:
        cat = EVENT_CATEGORY_MAP.get(act.get("event_type", ""), "General")
        groups[cat].append(act)
    return {k: v for k, v in groups.items() if v}


def _summarise_group(group: list[dict]) -> str:
    lines = []
    for act in group[:25]:
        ts = ""
        if act.get("timestamp") and isinstance(act["timestamp"], datetime.datetime):
            ts = act["timestamp"].strftime("%b %d")
        elif isinstance(act.get("timestamp"), str):
            ts = act["timestamp"][:10]
        repo = act.get("repo") or ""
        lines.append(
            f"- [{act.get('event_type', '?')}] {repo}: "
            f"{act.get('title', '')} ({ts}) {act.get('url', '')}"
        )
    return "\n".join(lines)


def generate_from_activities(
    activities: list[dict],
    month_year: str,
    api_key: str,
) -> list[GeneratorResult]:
    """Generate one article per activity category.

    Parameters
    ----------
    activities:
        List of activity dicts with keys: ``event_type``, ``repo``, ``title``,
        ``url``, ``timestamp``.
    month_year:
        Human-readable month/year string for the edition (e.g. ``"March 2026"``).
    api_key:
        OpenAI API key.
    """
    groups = _group_activities(activities)
    results: list[GeneratorResult] = []

    for category, group_acts in groups.items():
        summary = _summarise_group(group_acts)
        category_instruction = CATEGORY_PROMPTS.get(category, CATEGORY_PROMPTS["General"])
        prompt = (
            f"Write a newspaper article for the '{category}' section of the "
            f"{month_year} edition of ¡Albricias!.\n\n"
            f"{category_instruction}\n\n"
            f"Base it on the following activity:\n{summary}\n\n"
            f"Give the article a compelling headline (as a markdown H1), then the "
            f"body text. Do not include a byline or date — those are added separately."
        )

        try:
            raw = call_openai(system=NEWSPAPER_PERSONA, user=prompt, api_key=api_key)
        except Exception as exc:
            print(f"[chronicle] OpenAI call failed for '{category}': {exc}")
            continue

        fallback = f"{category} Dispatch — {month_year}"
        title, content = parse_response(raw, fallback)

        results.append(
            GeneratorResult(
                title=title,
                content=content,
                category=category,
                source_data={
                    "generator": "chronicle",
                    "prompt": prompt,
                    "response": raw,
                    "model": "gpt-4o-mini",
                    "activity_count": len(group_acts),
                },
            )
        )

    return results
