"""Interview generator.

Transforms a conversation transcription into a classic Q&A newspaper interview,
with clearly attributed speaker turns and an editorial introduction.
"""

from __future__ import annotations

from app.services.generators import GeneratorResult
from app.services.generators._base import NEWSPAPER_PERSONA, call_openai, parse_response

_SYSTEM = (
    NEWSPAPER_PERSONA
    + "\n\n"
    "You are writing the Interviews section. Format the piece as a classic Q&A: "
    "a brief editorial introduction (2–3 sentences) followed by the dialogue in the "
    "form 'Q: ...' and 'A: ...' (or with real names if discernible). "
    "The interviewer's voice should be incisive and curious; the subject's replies "
    "should be faithfully reproduced but lightly polished for the printed page. "
    "Keep the total length between 250 and 500 words."
)

_PROMPT_TEMPLATE = """\
Based on the following conversation or interview transcription, write a polished \
Q&A article for ¡Albricias!.

Begin with a compelling headline (Markdown H1), then a short editorial introduction, \
then the Q&A body. Do not include a byline or date.

{interviewee_line}\
Transcription:
{text}
"""


def generate(text: str, api_key: str, interviewee_name: str = "", topic_hint: str = "") -> GeneratorResult:
    """Generate a Q&A interview article from *text*.

    Parameters
    ----------
    text:
        Conversation transcription.
    api_key:
        OpenAI API key.
    interviewee_name:
        Name of the person being interviewed, if known (helps attribution).
    topic_hint:
        Optional extra focus instruction.
    """
    interviewee_line = f"The person being interviewed is: {interviewee_name}.\n\n" if interviewee_name else ""
    user_prompt = _PROMPT_TEMPLATE.format(text=text, interviewee_line=interviewee_line)
    if topic_hint:
        user_prompt += f"\n\nAdditional focus: {topic_hint}"

    raw = call_openai(system=_SYSTEM, user=user_prompt, api_key=api_key, max_tokens=900)
    title, content = parse_response(raw, fallback="An Interview With a Remarkable Personage")

    return GeneratorResult(
        title=title,
        content=content,
        category="Front Page",
        source_data={
            "generator": "interview",
            "prompt": user_prompt,
            "response": raw,
            "model": "gpt-4o-mini",
            "interviewee_name": interviewee_name,
            "topic_hint": topic_hint,
        },
    )
