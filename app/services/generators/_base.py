"""Shared utilities for all generator modules."""

from __future__ import annotations

NEWSPAPER_PERSONA = (
    "You are the chief editor of ¡Albricias!, a whimsical vintage newspaper "
    "published in the style of early 20th-century broadsheets. "
    "Your writing is eloquent, slightly dramatic, and uses the grandiloquent "
    "journalistic voice of a bygone era — yet the content is accurate and grounded "
    "in the actual material provided. "
    "Use markdown for formatting."
)


def call_openai(system: str, user: str, api_key: str, temperature: float = 0.8, max_tokens: int = 800) -> str:
    """Call the OpenAI Chat Completions API and return the raw response text."""
    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai is required: uv add openai")

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


def parse_response(raw: str, fallback: str) -> tuple[str, str]:
    """Extract a Markdown H1 headline and body from an LLM response.

    Returns ``(title, body)``.  If no H1 is found, *fallback* is used as the
    title and the entire response is returned as the body.
    """
    lines = raw.strip().split("\n")
    title = ""
    body_lines: list[str] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            body_lines = lines[i + 1:]
            break
    if not title:
        title = fallback
        body_lines = lines
    body = "\n".join(body_lines).strip() or raw.strip()
    return title, body
