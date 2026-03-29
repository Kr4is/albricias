"""Sources package — input processors for assisted content generation.

Each source module exposes a ``process()`` function that ingests raw input
(file bytes, plain text, etc.) and returns a :class:`SourceResult` with
normalized text ready for a generator.
"""

from dataclasses import dataclass, field


@dataclass
class SourceResult:
    """Normalized output from any source processor."""

    text: str
    source_type: str  # "audio_monologue" | "audio_conversation" | "text" | "notes"
    metadata: dict = field(default_factory=dict)


SOURCES: dict[str, str] = {
    "audio_monologue": "Audio — Monologue",
    "audio_conversation": "Audio — Conversation / Interview",
    "text": "Text / Transcription",
    "notes": "Notes / Bullet Points",
}
