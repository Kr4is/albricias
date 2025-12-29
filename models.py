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
        
    @property
    def weather(self):
        """Generate a deterministic weather report based on the issue date."""
        import hashlib
        
        # Parse month from date (date_str is "Week of Month D, YYYY" or id has date)
        # We store year and could parse date. reliable way is id "week-YYYY-MM-DD"
        try:
            date_part = self.id.replace("week-", "")
            y, m, d = map(int, date_part.split("-"))
        except:
            return "Clear, 20°C"

        # Deterministic random seed based on date
        seed = int(hashlib.sha256(self.id.encode()).hexdigest(), 16) % 100
        
        # Base temps (Celsius) by Season (Northern Hemisphere)
        if m in [12, 1, 2]: # Winter
            base_temp = 2
            conditions = ["Snowy", "Frigid", "Clear", "Overcast"]
        elif m in [3, 4, 5]: # Spring
            base_temp = 15
            conditions = ["Rainy", "Cloudy", "Breezy", "Mild"]
        elif m in [6, 7, 8]: # Summer
            base_temp = 28
            conditions = ["Sunny", "Hot", "Humid", "Clear"]
        else: # Fall
            base_temp = 12
            conditions = ["Windy", "Rainy", "Crisp", "Foggy"]
            
        # Add variation (-5 to +5)
        temp_variation = (seed % 11) - 5
        final_temp = base_temp + temp_variation
        
        condition = conditions[seed % len(conditions)]
        
        return f"{condition}, {final_temp}°C"


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
    
    # New fields for dynamic continuous feed
    date = db.Column(db.Date, nullable=True)
    image = db.Column(db.String(500), nullable=True)
    audio = db.Column(db.String(500), nullable=True)
    video = db.Column(db.String(500), nullable=True)

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
