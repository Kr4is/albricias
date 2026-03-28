"""Article model — individual piece of content within an edition."""

import json
import datetime
from app.extensions import db


class Article(db.Model):
    """Individual article within an edition."""

    __tablename__ = "articles"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    edition_id = db.Column(
        db.Integer, db.ForeignKey("editions.id"), nullable=False, index=True
    )
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50), nullable=False, default="General")
    author = db.Column(db.String(100), nullable=True)
    deck = db.Column(db.String(10), nullable=False, default="A")
    order = db.Column(db.Integer, nullable=False, default=0)
    date = db.Column(db.Date, nullable=True)

    # Media — image/audio stored locally; video is always a URL
    image = db.Column(db.String(500), nullable=True)
    audio = db.Column(db.String(500), nullable=True)
    video = db.Column(db.String(500), nullable=True)

    # Provenance: "manual" | "ai_generated" | "github"
    source_type = db.Column(db.String(30), nullable=False, default="manual")
    # JSON blob: original prompt, AI response, raw API payload, etc.
    source_data = db.Column(db.Text, nullable=True)

    created_at = db.Column(
        db.DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    def __repr__(self) -> str:
        return f"<Article {self.id}: {self.title[:30]}>"

    # ------------------------------------------------------------------
    # Helpers for source_data JSON field
    # ------------------------------------------------------------------

    def get_source_data(self) -> dict:
        """Return source_data parsed as a dict, or empty dict."""
        if self.source_data:
            try:
                return json.loads(self.source_data)
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}

    def set_source_data(self, data: dict) -> None:
        """Serialise *data* to JSON and store it."""
        self.source_data = json.dumps(data)

    # ------------------------------------------------------------------
    # Template compatibility
    # ------------------------------------------------------------------

    @property
    def lead_story(self) -> dict:
        return {"title": self.title, "content": self.content, "deck": self.deck}
