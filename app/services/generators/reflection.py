"""Reflection / Essay generator.

Transforms a monologue transcription or notes into a first-person vintage
editorial piece — the voice of a thoughtful correspondent reflecting on an
experience, idea, or event.
"""

from __future__ import annotations

from app.services.generators import GeneratorResult
from app.services.generators._base import NEWSPAPER_PERSONA, call_openai, parse_response

_SYSTEM = (
    NEWSPAPER_PERSONA
    + "\n\n"
    "You are writing the Opinion & Reflection column — a first-person editorial "
    "in the tradition of great essayists. The piece should feel personal, contemplative, "
    "and eloquently argued. Use 'I' throughout. Keep it between 200 and 400 words."
)

_PROMPT_TEMPLATE = """\
Based on the following notes or transcription, write a reflective essay / opinion \
column for ¡Albricias!.

The article must begin with a compelling headline (formatted as a Markdown H1), \
followed by the body. Do not include a byline or date.

Source material:
{text}
"""


def generate(text: str, api_key: str, topic_hint: str = "") -> GeneratorResult:
    """Generate a reflection/essay article from *text*.

    Parameters
    ----------
    text:
        Source text (monologue transcription or notes).
    api_key:
        OpenAI API key.
    topic_hint:
        Optional extra context/instruction to focus the piece (e.g. "focus on
        the challenges of remote work").
    """
    user_prompt = _PROMPT_TEMPLATE.format(text=text)
    if topic_hint:
        user_prompt += f"\n\nAdditional focus: {topic_hint}"

    raw = call_openai(system=_SYSTEM, user=user_prompt, api_key=api_key)
    title, content = parse_response(raw, fallback="Reflections From the Correspondent's Desk")

    return GeneratorResult(
        title=title,
        content=content,
        category="Editorial",
        source_data={
            "generator": "reflection",
            "prompt": user_prompt,
            "response": raw,
            "model": "gpt-4o-mini",
            "topic_hint": topic_hint,
        },
    )
