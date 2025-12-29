"""Database models for Albricias newspaper application."""

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Issue(db.Model):
    """Weekly edition/cover that compiles multiple articles."""

    __tablename__ = "issues"

    id = db.Column(db.String(50), primary_key=True)  # e.g., "week-oct-23-2023"
    date = db.Column(db.String(100), nullable=False)  # "Week of October 23, 2023"
    date_short = db.Column(db.String(20), nullable=False)  # "Oct 23"
    vol = db.Column(db.String(50), nullable=False)  # "CXLIII NO. 49"
    year = db.Column(db.Integer, nullable=False, index=True)  # 2023
    cover_image = db.Column(db.String(500), nullable=False)

    # Relationship to articles
    articles = db.relationship("Article", backref="issue", lazy="dynamic", order_by="Article.order")

    def __repr__(self):
        return f"<Issue {self.id}>"

    @property
    def lead_article(self):
        """Return the first/lead article of this issue."""
        return self.articles.order_by(Article.order).first()


class Article(db.Model):
    """Individual article within an issue."""

    __tablename__ = "articles"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    issue_id = db.Column(db.String(50), db.ForeignKey("issues.id"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50), nullable=False)  # e.g., "Politics", "Arts", "Business"
    author = db.Column(db.String(100), nullable=True)
    deck = db.Column(db.String(10), nullable=False)  # First letter for drop cap
    order = db.Column(db.Integer, nullable=False, default=0)  # Order within issue

    def __repr__(self):
        return f"<Article {self.id}: {self.title[:30]}>"

    @property
    def lead_story(self):
        """Compatibility property for templates expecting lead_story dict."""
        return {
            "title": self.title,
            "content": self.content,
            "deck": self.deck,
        }
