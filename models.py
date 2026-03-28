"""Database models for Albricias newspaper application."""

import json
import hashlib
import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

EDITION_STATUS_DRAFT = "draft"
EDITION_STATUS_PUBLISHED = "published"


class Edition(db.Model):
    """Monthly edition that compiles multiple articles."""

    __tablename__ = "editions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    month = db.Column(db.Integer, nullable=False)       # 1–12
    year = db.Column(db.Integer, nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)    # e.g. "March 2026"
    status = db.Column(db.String(20), nullable=False, default=EDITION_STATUS_DRAFT, index=True)
    cover_image = db.Column(db.String(500), nullable=True)
    vol = db.Column(db.String(50), nullable=False)       # e.g. "VOL. 2026 NO. 3"
    published_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("year", "month", name="uq_edition_year_month"),
    )

    articles = db.relationship(
        "Article", backref="edition", lazy="dynamic", order_by="Article.order"
    )
    github_activities = db.relationship(
        "GitHubActivity", backref="edition", lazy="dynamic"
    )

    def __repr__(self):
        return f"<Edition {self.year}-{self.month:02d} [{self.status}]>"

    @property
    def date(self):
        """Human-readable month and year string."""
        return datetime.date(self.year, self.month, 1).strftime("%B %Y")

    @property
    def date_short(self):
        """Short month and year string."""
        return datetime.date(self.year, self.month, 1).strftime("%b %Y")

    @property
    def lead_article(self):
        """Return the first/lead article of this edition."""
        return self.articles.order_by(Article.order).first()

    @property
    def weather(self):
        """Generate a deterministic weather report based on the edition month."""
        seed = int(hashlib.sha256(f"{self.year}-{self.month}".encode()).hexdigest(), 16) % 100
        m = self.month
        if m in [12, 1, 2]:
            base_temp, conditions = 2, ["Snowy", "Frigid", "Clear", "Overcast"]
        elif m in [3, 4, 5]:
            base_temp, conditions = 15, ["Rainy", "Cloudy", "Breezy", "Mild"]
        elif m in [6, 7, 8]:
            base_temp, conditions = 28, ["Sunny", "Hot", "Humid", "Clear"]
        else:
            base_temp, conditions = 12, ["Windy", "Rainy", "Crisp", "Foggy"]
        temp = base_temp + (seed % 11) - 5
        condition = conditions[seed % len(conditions)]
        return f"{condition}, {temp}°C"

    @property
    def is_published(self):
        return self.status == EDITION_STATUS_PUBLISHED


class Article(db.Model):
    """Individual article within an edition."""

    __tablename__ = "articles"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    edition_id = db.Column(db.Integer, db.ForeignKey("editions.id"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50), nullable=False, default="General")
    author = db.Column(db.String(100), nullable=True)
    deck = db.Column(db.String(10), nullable=False, default="A")
    order = db.Column(db.Integer, nullable=False, default=0)
    date = db.Column(db.Date, nullable=True)

    # Media
    image = db.Column(db.String(500), nullable=True)
    audio = db.Column(db.String(500), nullable=True)
    # Video is a URL/embed (YouTube, Vimeo, etc.) — no local file storage
    video = db.Column(db.String(500), nullable=True)

    # Provenance
    # Values: "manual", "ai_generated", "github"
    source_type = db.Column(db.String(30), nullable=False, default="manual")
    # Raw data used to generate this article (prompt, API response, etc.) as JSON string
    source_data = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    def __repr__(self):
        return f"<Article {self.id}: {self.title[:30]}>"

    def get_source_data(self):
        """Return source_data parsed as a dict, or empty dict if not set."""
        if self.source_data:
            try:
                return json.loads(self.source_data)
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}

    def set_source_data(self, data: dict):
        """Serialize dict to JSON and store in source_data."""
        self.source_data = json.dumps(data)

    @property
    def lead_story(self):
        """Compatibility property for templates."""
        return {
            "title": self.title,
            "content": self.content,
            "deck": self.deck,
        }


class GitHubActivity(db.Model):
    """Raw GitHub activity fetched for an edition before AI summarization."""

    __tablename__ = "github_activities"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    edition_id = db.Column(db.Integer, db.ForeignKey("editions.id"), nullable=False, index=True)

    # Type: "commit", "pr", "issue", "release", "star"
    event_type = db.Column(db.String(30), nullable=False)
    repo = db.Column(db.String(200), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    url = db.Column(db.String(500), nullable=True)
    timestamp = db.Column(db.DateTime, nullable=True)
    # Full raw payload from GitHub API as JSON string
    raw_json = db.Column(db.Text, nullable=True)

    def __repr__(self):
        return f"<GitHubActivity {self.event_type} {self.repo}>"

    def get_raw(self):
        """Return raw_json parsed as dict."""
        if self.raw_json:
            try:
                return json.loads(self.raw_json)
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}
