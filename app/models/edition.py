"""Edition model — one monthly publication."""

import datetime
import hashlib
from app.extensions import db

EDITION_STATUS_DRAFT = "draft"
EDITION_STATUS_PUBLISHED = "published"


class Edition(db.Model):
    """Monthly edition that compiles multiple articles."""

    __tablename__ = "editions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    month = db.Column(db.Integer, nullable=False)
    year = db.Column(db.Integer, nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    status = db.Column(
        db.String(20),
        nullable=False,
        default=EDITION_STATUS_DRAFT,
        index=True,
    )
    cover_image = db.Column(db.String(500), nullable=True)
    vol = db.Column(db.String(50), nullable=False)
    published_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(
        db.DateTime, nullable=False, default=datetime.datetime.utcnow
    )

    __table_args__ = (
        db.UniqueConstraint("year", "month", name="uq_edition_year_month"),
    )

    articles = db.relationship(
        "Article",
        backref="edition",
        lazy="dynamic",
        order_by="Article.order",
        cascade="all, delete-orphan",
    )
    github_activities = db.relationship(
        "GitHubActivity",
        backref="edition",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Edition {self.year}-{self.month:02d} [{self.status}]>"

    # ------------------------------------------------------------------
    # Computed properties used by templates
    # ------------------------------------------------------------------

    @property
    def date(self) -> str:
        """Human-readable month and year: 'March 2026'."""
        return datetime.date(self.year, self.month, 1).strftime("%B %Y")

    @property
    def date_short(self) -> str:
        """Short form: 'Mar 2026'."""
        return datetime.date(self.year, self.month, 1).strftime("%b %Y")

    @property
    def lead_article(self):
        """First article of this edition, ordered by Article.order."""
        from app.models.article import Article

        return self.articles.order_by(Article.order).first()

    @property
    def weather(self) -> str:
        """Deterministic pseudo-weather string based on the edition month."""
        seed = (
            int(
                hashlib.sha256(f"{self.year}-{self.month}".encode()).hexdigest(),
                16,
            )
            % 100
        )
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
    def is_published(self) -> bool:
        return self.status == EDITION_STATUS_PUBLISHED
