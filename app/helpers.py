"""Pure utility helpers — no route logic, no Flask app references."""

import os
import re
from flask import current_app
from werkzeug.utils import secure_filename

from app.models import Edition


def slugify(text: str) -> str:
    """Convert *text* into a URL-safe slug."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text


def layout_index(edition: Edition) -> int:
    """Return a deterministic layout number (1–5) based on edition month."""
    return (edition.month % 5) + 1


def save_media_file(file_obj, media_type: str, edition_prefix: str) -> str | None:
    """Save an uploaded image or audio file and return its web-accessible path.

    *media_type* must be ``"image"`` or ``"audio"``.
    Returns ``None`` if no file was provided.
    """
    if not file_obj or file_obj.filename == "":
        return None

    filename = secure_filename(file_obj.filename)
    base, ext = os.path.splitext(filename)
    unique_name = f"{edition_prefix}-{slugify(base)}{ext}"
    folder = os.path.join(
        current_app.config["UPLOAD_FOLDER"], media_type + "s"
    )
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, unique_name)

    if media_type == "image":
        try:
            from PIL import Image

            img = Image.open(file_obj)
            max_width = 1200
            if img.width > max_width:
                ratio = max_width / img.width
                img = img.resize(
                    (max_width, int(img.height * ratio)), Image.LANCZOS
                )
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
                unique_name = os.path.splitext(unique_name)[0] + ".jpg"
                dest = os.path.join(folder, unique_name)
            img.save(dest, "JPEG", quality=80, optimize=True)
        except (ImportError, Exception):
            file_obj.seek(0)
            file_obj.save(dest)
    else:
        file_obj.save(dest)

    return f"/static/uploads/{media_type}s/{unique_name}"
