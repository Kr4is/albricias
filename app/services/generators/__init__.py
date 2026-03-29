"""Generators package — article type processors for assisted content generation.

Each generator module exposes a ``generate()`` function that accepts a block of
source text plus an OpenAI API key and returns a :class:`GeneratorResult`.
"""

from dataclasses import dataclass, field


@dataclass
class GeneratorResult:
    """Structured output from any article generator."""

    title: str
    content: str          # Markdown body
    category: str         # Suggested newspaper section
    source_data: dict = field(default_factory=dict)


GENERATORS: dict[str, str] = {
    "reflection": "Reflection / Essay",
    "interview": "Interview",
    "review": "Review",
    "profile": "Profile / Feature",
}

GENERATOR_CATEGORIES: dict[str, str] = {
    "reflection": "Editorial",
    "interview": "Front Page",
    "review": "Arts & Letters",
    "profile": "Front Page",
}
