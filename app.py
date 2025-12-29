"""Albricias - A vintage newspaper-style web application."""

import os
from flask import Flask, render_template, request
from models import db, Issue, Article
from dotenv import load_dotenv
import markdown

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Database configuration
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("SQLALCHEMY_DATABASE_URI", "sqlite:///albricias.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-key")

db.init_app(app)

# Register Markdown filter
@app.template_filter('markdown')
def markdown_filter(text):
    return markdown.markdown(text, extensions=['fenced_code', 'tables'])


import json
import glob
import frontmatter

# ... (Previous imports remain, ensure frontmatter is imported)

def load_content_from_files():
    """Load issues and articles from the content/ directory."""
    issues_path = os.path.join(app.root_path, "content", "issues")
    if not os.path.exists(issues_path):
        print(f"No content directory found at {issues_path}")
        return

    # Find all issue directories
    issue_dirs = sorted(glob.glob(os.path.join(issues_path, "*")))

    for issue_dir in issue_dirs:
        if not os.path.isdir(issue_dir):
            continue

        issue_id = os.path.basename(issue_dir)
        metadata_path = os.path.join(issue_dir, "metadata.json")

        if not os.path.exists(metadata_path):
            continue

        # Load Issue Metadata
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)

        # check if issue exists
        if db.session.get(Issue, issue_id):
           continue
        
        issue = Issue(
            id=issue_id,
            date=metadata.get("date"),
            date_short=metadata.get("date_short"),
            vol=metadata.get("vol"),
            year=metadata.get("year"),
            cover_image=metadata.get("cover_image")
        )
        db.session.add(issue)

        # Load Articles
        article_files = sorted(glob.glob(os.path.join(issue_dir, "*.md")))
        for article_file in article_files:
            post = frontmatter.load(article_file)
            
            article = Article(
                issue_id=issue.id,
                title=post.get("title"),
                content=post.content,
                category=post.get("category"),
                author=post.get("author"),
                deck=post.get("deck"),
                order=post.get("order", 0)
            )
            db.session.add(article)

    db.session.commit()
    print("Database seeded from filesystem content.")

def seed_database():
    """Seed the database with initial issues and articles if empty."""
    # Check if we have any data, if not, try to load from files
    if Issue.query.first() is None:
        load_content_from_files()



@app.route("/")
def home():
    """Render the current issue (home page) using the issue template."""
    # Get the most recent issue
    # Sort by year desc, then implicitly by date logic or just grab the "latest" by ID if needed, 
    # but here we rely on the filesystem/db order. 
    # Since IDs are strings like 'week-oct-23-2023', pure alphabetical might be wrong for dates.
    # But let's assume the DB order or explicit date field is what we want.
    # For now, relying on Issue.year desc and maybe we should parse date.
    # Actually, the best way for now given the current data is to trust the import order or sort by ID if they are ISO-like?
    # IDs are 'week-oct-23-2023'. 
    # Let's rely on the query used in archive:
    latest_issue = Issue.query.order_by(Issue.year.desc(), Issue.id.desc()).first() # Approximation
    
    if latest_issue is None:
        return render_template("404.html"), 404

    # Get prev/next navigation
    # specific logic for latest issue: next is None.
    prev_issue = Issue.query.filter(Issue.id != latest_issue.id).order_by(Issue.year.desc(), Issue.id.desc()).offset(1).first() # Just the next one in list
    # Actually, let's just reuse the logic:
    # We want the one immediately 'before' this one in time.
    # Since we picked the FIRST one (latest), the 'prev' is the second one.
    prev_issue = Issue.query.filter(Issue.id < latest_issue.id).order_by(Issue.id.desc()).first() # ID string comparison might be flaky but let's stick to simple for now or fetch all and pick.
    # Better:
    all_issues = Issue.query.all()
    # Sort them in python to be sure about date if needed, but ID sort is what we have used.
    # Let's stick to the same logic as issue_detail if possible.
    
    # Re-fetching based on ID for consistency with issue_detail logic
    prev_issue = Issue.query.filter(Issue.id < latest_issue.id).order_by(Issue.id.desc()).first()
    next_issue = None # Latest has no next

    return render_template("issue.html", issue=latest_issue, prev_issue=prev_issue, next_issue=None, Article=Article)


@app.route("/archive")
def archive():
    """Render the past editions archive with filtering and pagination."""
    # Get query parameters
    selected_year = request.args.get("year", "All Years")
    view_mode = request.args.get("view", "issues")  # 'issues' or 'articles'
    page = request.args.get("page", 1, type=int)
    per_page = 8

    # Get distinct years from database
    years_result = db.session.query(Issue.year).distinct().order_by(Issue.year.desc()).all()
    years = ["All Years"] + [str(year[0]) for year in years_result]

    if view_mode == "articles":
        # Browse by articles
        query = Article.query.join(Issue).order_by(Issue.year.desc(), Article.order)

        if selected_year != "All Years":
            try:
                year_int = int(selected_year)
                query = query.filter(Issue.year == year_int)
            except ValueError:
                pass

        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        items = pagination.items

        # Get distinct categories for filtering
        categories = db.session.query(Article.category).distinct().order_by(Article.category).all()
        categories = [cat[0] for cat in categories]

        return render_template(
            "archive.html",
            items=items,
            years=years,
            selected_year=selected_year,
            view_mode=view_mode,
            pagination=pagination,
            categories=categories,
        )
    else:
        # Browse by issues (default)
        query = Issue.query.order_by(Issue.year.desc(), Issue.date_short.desc())

        if selected_year != "All Years":
            try:
                year_int = int(selected_year)
                query = query.filter(Issue.year == year_int)
            except ValueError:
                pass

        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        items = pagination.items

        return render_template(
            "archive.html",
            items=items,
            years=years,
            selected_year=selected_year,
            view_mode=view_mode,
            pagination=pagination,
            categories=[],
        )


@app.route("/issue/<issue_id>")
def issue_detail(issue_id):
    """Render an individual issue page with all its articles."""
    issue = db.session.get(Issue, issue_id)
    if issue is None:
        return render_template("404.html"), 404

    # Get previous and next issues for navigation
    prev_issue = Issue.query.filter(Issue.id < issue.id).order_by(Issue.id.desc()).first()
    next_issue = Issue.query.filter(Issue.id > issue.id).order_by(Issue.id.asc()).first()

    return render_template("issue.html", issue=issue, prev_issue=prev_issue, next_issue=next_issue, Article=Article)


@app.route("/article/<int:article_id>")
def article_detail(article_id):
    """Render an individual article page."""
    article = db.session.get(Article, article_id)
    if article is None:
        return render_template("404.html"), 404

    # Get previous and next articles within the same issue
    prev_article = Article.query.filter(
        Article.issue_id == article.issue_id,
        Article.order < article.order
    ).order_by(Article.order.desc()).first()

    next_article = Article.query.filter(
        Article.issue_id == article.issue_id,
        Article.order > article.order
    ).order_by(Article.order.asc()).first()

    return render_template(
        "article.html",
        article=article,
        prev_article=prev_article,
        next_article=next_article,
    )


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed_database()
    app.run(debug=True)
