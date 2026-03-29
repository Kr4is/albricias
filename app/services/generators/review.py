"""Review generator.

Transforms notes or a description into a structured critique column — covering
books, tools, films, restaurants, albums, or any subject the correspondent
deems worthy of the reading public's attention.
"""

from __future__ import annotations

from app.services.generators import GeneratorResult
from app.services.generators._base import NEWSPAPER_PERSONA, call_openai, parse_response

_SYSTEM = (
    NEWSPAPER_PERSONA
    + "\n\n"
    "You are writing the Reviews & Critiques column. Structure the piece as a "
    "vintage newspaper review: a brief summary of the subject, followed by the "
    "correspondent's measured assessment (praise and criticism alike), and a "
    "final verdict. Be opinionated — the great critics were never neutral. "
    "Keep the total between 200 and 350 words."
)

_PROMPT_TEMPLATE = """\
Based on the following notes, write a vintage-style review article for ¡Albricias!.

{subject_line}\
Begin with a compelling headline (Markdown H1), then the review body with a clear \
verdict at the end. Do not include a byline or date.

Notes:
{text}
"""

_SUBJECT_LABELS = {
    "book": "Book",
    "film": "Film",
    "tool": "Software / Tool",
    "restaurant": "Restaurant",
    "album": "Album / Music",
    "other": "",
}


def generate(
    text: str,
    api_key: str,
    subject_name: str = "",
    subject_type: str = "other",
    topic_hint: str = "",
) -> GeneratorResult:
    """Generate a review article from *text*.

    Parameters
    ----------
    text:
        Notes or description of the subject being reviewed.
    api_key:
        OpenAI API key.
    subject_name:
        Name of the book / film / tool / etc.
    subject_type:
        One of ``"book"``, ``"film"``, ``"tool"``, ``"restaurant"``, ``"album"``,
        or ``"other"``.
    topic_hint:
        Optional extra focus instruction.
    """
    label = _SUBJECT_LABELS.get(subject_type, "")
    subject_line = ""
    if subject_name:
        subject_line = f"The subject being reviewed is: {label + ' — ' if label else ''}{subject_name}.\n\n"

    user_prompt = _PROMPT_TEMPLATE.format(text=text, subject_line=subject_line)
    if topic_hint:
        user_prompt += f"\n\nAdditional focus: {topic_hint}"

    raw = call_openai(system=_SYSTEM, user=user_prompt, api_key=api_key)
    title, content = parse_response(raw, fallback="A Critic's Assessment")

    return GeneratorResult(
        title=title,
        content=content,
        category="Arts & Letters",
        source_data={
            "generator": "review",
            "prompt": user_prompt,
            "response": raw,
            "model": "gpt-4o-mini",
            "subject_name": subject_name,
            "subject_type": subject_type,
            "topic_hint": topic_hint,
        },
    )
