"""Text / notes source processor — normalizes pasted text or uploaded .txt files.

No external API calls; the text is cleaned and passed straight to generators.
"""

from __future__ import annotations

import re
from typing import BinaryIO

from app.services.sources import SourceResult


def _normalize(raw: str) -> str:
    """Strip excessive whitespace and normalize line endings."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def process_text(raw: str, source_type: str = "text") -> SourceResult:
    """Process a plain-text string (e.g. a pasted transcription or notes).

    Parameters
    ----------
    raw:
        The raw text content.
    source_type:
        ``"text"`` for a transcription/prose or ``"notes"`` for bullet-point notes.
    """
    normalized = _normalize(raw)
    word_count = len(normalized.split()) if normalized else 0
    return SourceResult(
        text=normalized,
        source_type=source_type,
        metadata={"word_count": word_count, "char_count": len(normalized)},
    )


def process_file(file_obj: BinaryIO, filename: str, source_type: str = "text") -> SourceResult:
    """Read and process an uploaded plain-text file (.txt).

    Parameters
    ----------
    file_obj:
        Uploaded file object.
    filename:
        Original filename (used only for metadata).
    source_type:
        ``"text"`` or ``"notes"``.
    """
    raw = file_obj.read().decode("utf-8", errors="replace")
    result = process_text(raw, source_type=source_type)
    result.metadata["filename"] = filename
    return result
