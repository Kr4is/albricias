"""ServiceActivity model — raw external service event stored before AI summarisation.

Stores activity from any integrated service (GitHub, Spotify, etc.).
The ``source`` field identifies the service; ``event_type`` distinguishes
sub-types within a service (e.g. "commit", "star", "spotify_track").
"""

import json
import datetime
from app.extensions import db


class ServiceActivity(db.Model):
    """Raw activity fetched from an external service for an edition."""

    __tablename__ = "service_activities"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    edition_id = db.Column(
        db.Integer, db.ForeignKey("editions.id"), nullable=False, index=True
    )

    # e.g. "github" | "spotify"
    source = db.Column(db.String(30), nullable=False, default="github", index=True)
    # e.g. "commit" | "pr" | "star" | "spotify_track" | "spotify_artist"
    event_type = db.Column(db.String(30), nullable=False)
    repo = db.Column(db.String(200), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    url = db.Column(db.String(500), nullable=True)
    timestamp = db.Column(db.DateTime, nullable=True)
    raw_json = db.Column(db.Text, nullable=True)

    def __repr__(self) -> str:
        return f"<ServiceActivity [{self.source}] {self.event_type} {self.repo}>"

    def get_raw(self) -> dict:
        """Return raw_json parsed as dict."""
        if self.raw_json:
            try:
                return json.loads(self.raw_json)
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}
