"""Audio source processor — transcribes uploaded audio via OpenAI Whisper.

Two modes are supported:

* ``monologue`` — single speaker; simple transcription.
* ``conversation`` — multiple speakers; Whisper is prompted to indicate
  speaker turns so downstream generators can produce Q&A structure.
"""

from __future__ import annotations

import io
import os
from typing import BinaryIO

from app.services.sources import SourceResult

# Whisper supports these container/codec combinations
SUPPORTED_AUDIO_EXTENSIONS = {".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".ogg", ".flac"}

_CONVERSATION_PROMPT = (
    "The following is a conversation or interview between two or more people. "
    "Please transcribe it clearly, indicating speaker changes with 'Speaker 1:', "
    "'Speaker 2:', etc. when a new speaker begins talking."
)


def process(
    file_obj: BinaryIO,
    filename: str,
    mode: str,
    api_key: str,
) -> SourceResult:
    """Transcribe *file_obj* using OpenAI Whisper.

    Parameters
    ----------
    file_obj:
        File-like object with the audio bytes (e.g. ``request.files['audio']``).
    filename:
        Original filename, used to pass the correct extension to the API.
    mode:
        ``"monologue"`` or ``"conversation"``.
    api_key:
        OpenAI API key.

    Returns
    -------
    SourceResult
        ``source_type`` is ``"audio_monologue"`` or ``"audio_conversation"``.
    """
    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai is required: uv add openai")

    client = OpenAI(api_key=api_key)

    audio_bytes = file_obj.read()
    audio_buffer = io.BytesIO(audio_bytes)
    audio_buffer.name = filename

    kwargs: dict = {
        "model": "whisper-1",
        "file": audio_buffer,
        "response_format": "text",
    }
    if mode == "conversation":
        kwargs["prompt"] = _CONVERSATION_PROMPT

    transcription: str = client.audio.transcriptions.create(**kwargs)

    word_count = len(transcription.split()) if transcription else 0
    return SourceResult(
        text=transcription.strip(),
        source_type=f"audio_{mode}",
        metadata={
            "filename": filename,
            "mode": mode,
            "word_count": word_count,
            "model": "whisper-1",
        },
    )
