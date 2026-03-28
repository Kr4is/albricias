"""GitHubActivity model — raw GitHub event stored before AI summarisation."""

import json
import datetime
from app.extensions import db


class GitHubActivity(db.Model):
    """Raw GitHub activity fetched for an edition before AI summarisation."""

    __tablename__ = "github_activities"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    edition_id = db.Column(
        db.Integer, db.ForeignKey("editions.id"), nullable=False, index=True
    )

    # "commit" | "pr" | "issue" | "release" | "star"
    event_type = db.Column(db.String(30), nullable=False)
    repo = db.Column(db.String(200), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    url = db.Column(db.String(500), nullable=True)
    timestamp = db.Column(db.DateTime, nullable=True)
    raw_json = db.Column(db.Text, nullable=True)

    def __repr__(self) -> str:
        return f"<GitHubActivity {self.event_type} {self.repo}>"

    def get_raw(self) -> dict:
        """Return raw_json parsed as dict."""
        if self.raw_json:
            try:
                return json.loads(self.raw_json)
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}
