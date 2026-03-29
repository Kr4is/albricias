"""Profile / Feature generator.

Transforms notes or conversation excerpts into a narrative feature article
spotlighting a person, project, or topic — in the style of a society-page
profile or a long-form feature story.
"""

from __future__ import annotations

from app.services.generators import GeneratorResult
from app.services.generators._base import NEWSPAPER_PERSONA, call_openai, parse_response

_SYSTEM = (
    NEWSPAPER_PERSONA
    + "\n\n"
    "You are writing the Profiles & Features section — long-form narrative journalism. "
    "Tell the story of the subject with colour and precision: their background, what "
    "makes them remarkable, and why the readers of ¡Albricias! should take note. "
    "The tone is warm but discerning, like a society-page profile from a distinguished "
    "broadsheet. Keep the total between 250 and 450 words."
)

_PROMPT_TEMPLATE = """\
Based on the following notes or transcription, write a profile / feature article \
for ¡Albricias!.

{subject_line}\
Begin with a compelling headline (Markdown H1), then the narrative body. \
Do not include a byline or date.

Source material:
{text}
"""


def generate(
    text: str,
    api_key: str,
    subject_name: str = "",
    topic_hint: str = "",
) -> GeneratorResult:
    """Generate a profile/feature article from *text*.

    Parameters
    ----------
    text:
        Source notes or conversation transcription about the subject.
    api_key:
        OpenAI API key.
    subject_name:
        Name of the person, project, or topic being profiled.
    topic_hint:
        Optional extra focus instruction.
    """
    subject_line = f"The subject of the profile is: {subject_name}.\n\n" if subject_name else ""
    user_prompt = _PROMPT_TEMPLATE.format(text=text, subject_line=subject_line)
    if topic_hint:
        user_prompt += f"\n\nAdditional focus: {topic_hint}"

    raw = call_openai(system=_SYSTEM, user=user_prompt, api_key=api_key, max_tokens=900)
    title, content = parse_response(raw, fallback="A Profile of a Notable Figure")

    return GeneratorResult(
        title=title,
        content=content,
        category="Front Page",
        source_data={
            "generator": "profile",
            "prompt": user_prompt,
            "response": raw,
            "model": "gpt-4o-mini",
            "subject_name": subject_name,
            "topic_hint": topic_hint,
        },
    )
