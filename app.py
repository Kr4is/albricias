"""Albricias - A vintage newspaper-style web application."""

import os
from flask import Flask, render_template, request, session, redirect, url_for, flash
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
app.config["UPLOAD_FOLDER"] = os.path.join(app.root_path, "static", "uploads")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB limit

db.init_app(app)

# Register Markdown filter
@app.template_filter('markdown')
def markdown_filter(text):
    return markdown.markdown(text, extensions=['fenced_code', 'tables'])

# Context processors to inject variables into all templates
@app.context_processor
def inject_newspaper_config():
    return dict(
        newspaper={
            "name": os.getenv("NEWSPAPER_NAME", "¡Albricias!"),
            "tagline": os.getenv("NEWSPAPER_TAGLINE", "All the News That's Fit to Print"),
            "price": os.getenv("NEWSPAPER_PRICE", "Two Cents")
        },
        now=datetime.datetime.now()
    )


import json
import glob
import frontmatter
import datetime
import re
from werkzeug.utils import secure_filename
from functools import wraps

def slugify(text):
    """Simple slugify function."""
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text).strip('-')
    return text

def require_api_token(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = os.getenv("API_TOKEN")
        if not token:
            # If no token is configured, we allow it (or we could block it)
            # But the user asked to securize it, so we should probably require it if set.
            return f(*args, **kwargs)
            
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return {"error": "Unauthorized: Missing or invalid token"}, 401
            
        token_sent = auth_header.split(" ")[1]
        if token_sent != token:
            return {"error": "Unauthorized: Invalid token"}, 401
            
        return f(*args, **kwargs)
    return decorated_function

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

def load_content_from_files():
    """Load articles from content/articles/ and generate weekly issues dynamically."""
    articles_path = os.path.join(app.root_path, "content", "articles")
    if not os.path.exists(articles_path):
        print(f"No content directory found at {articles_path}")
        return

    # Clear existing data for fresh seed (optional, but safer for dev)
    # In production, we might want upsert, but here we wipe to sync state.
    db.session.query(Article).delete()
    db.session.query(Issue).delete()
    
    # Memoize created issues in this session
    issues_cache = {}

    # Scan article files
    article_files = sorted(glob.glob(os.path.join(articles_path, "*.md")))
    
    for article_file in article_files:
        filename = os.path.basename(article_file)
        # Parse date from filename: YYYY-MM-DD-slug.md
        match = re.match(r"(\d{4})-(\d{2})-(\d{2})-(.*)\.md", filename)
        
        if not match:
            print(f"Skipping {filename}: Invalid date format")
            continue
            
        year, month, day, slug = match.groups()
        article_date = datetime.date(int(year), int(month), int(day))
        
        # Calculate Issue (Monday of the week)
        monday_date = article_date - datetime.timedelta(days=article_date.weekday())
        issue_id = f"week-{monday_date.isoformat()}"
        
        # Get or Create Issue
        if issue_id not in issues_cache:
            # Check DB (though we wiped, cache handles current session)
            # issue = db.session.get(Issue, issue_id) 
            # We wiped, so it won't exist in DB unless we added it in this loop.
            # But we check cache first.
            
            # Format dates
            date_str = f"Week of {monday_date.strftime('%B %-d, %Y')}"
            date_short = monday_date.strftime('%b %-d')
            
            # Placeholder for Volume/Cover
            vol_num = monday_date.isocalendar()[1]
            vol_str = f"VOL. {year} NO. {vol_num}"
            
            default_cover = "https://lh3.googleusercontent.com/aida-public/AB6AXuBp3_J4xTlbxtZw42osuYRDnHGOd68V4IJa_RWYpfIh4vfpy5Z722y_gXtCeyrHyz77I1cGAqKqr3puXjqr4tMfMBzfZsulCzp--KZj3bY_2b9E2AIW-I5HPj90Bv3iRbyRIb4QOwjPwHwMWi92l1tGn_836XzkN1_h2DBxM7H-OrHayMrdtzSgWsP6XV9MTSgrcjE2GTuYpM4fs970igX5Er1nRdKvs_1rO68D3UMuLm4Tu5rr2K-7XGo-2gV8gpbL2ST-8Fd7mmM"

            issue = Issue(
                id=issue_id,
                date=date_str,
                date_short=date_short,
                vol=vol_str,
                year=monday_date.year,
                cover_image=default_cover
            )
            db.session.add(issue)
            issues_cache[issue_id] = issue
        else:
            issue = issues_cache[issue_id]
            
        # Parse Frontmatter
        post = frontmatter.load(article_file)
        
        # Create Article
        article = Article(
            issue_id=issue.id,
            title=post.get("title"),
            content=post.content,
            category=post.get("category", "General"),
            author=post.get("author", "Staff Writer"),
            deck=post.get("deck", post.get("title", "A")[0]),
            order=post.get("order", 0), # Fallback order
            date=article_date,
            image=post.get("image"),
            audio=post.get("audio"),
            video=post.get("video")
        )
        db.session.add(article)

    db.session.commit()
    print("Database seeded from continuous article feed.")

def seed_database():
    """Seed the database with initial issues and articles."""
    # Always reload to reflect filesystem state
    load_content_from_files()

# Create tables and seed on startup
with app.app_context():
    db.create_all()
    # On first boot or whenever files change, we might want to seed.
    # Since we are adding an API that calls this, we can just seed once here.
    seed_database()




@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        password = request.form.get("password")
        admin_password = os.getenv("ADMIN_PASSWORD", "admin")
        if password == admin_password:
            session["logged_in"] = True
            return redirect(request.args.get("next") or url_for('home'))
        else:
            flash("Invalid password", "error")
            
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.pop("logged_in", None)
    return redirect(url_for('home'))

@app.route("/compose", methods=["GET", "POST"])
@login_required
def compose_article():
    if request.method == "POST":
        title = request.form.get("title")
        category = request.form.get("category")
        author = request.form.get("author", "Staff Writer")
        date_str = request.form.get("date")
        content = request.form.get("content")
        
        if not title or not content:
            flash("Headline and Narrative are required!", "error")
            return redirect(url_for('compose_article'))

        # Handle File Uploads
        media_paths = {"image": None, "audio": None, "video": None}
        for media_type in media_paths.keys():
            file = request.files.get(media_type)
            if file and file.filename != '':
                filename = secure_filename(file.filename)
                # Ensure unique filename to avoid collisions
                base, ext = os.path.splitext(filename)
                unique_filename = f"{date_str}-{slugify(title)}-{media_type}{ext}"
                
                upload_path = os.path.join(app.config["UPLOAD_FOLDER"], media_type + "s")
                os.makedirs(upload_path, exist_ok=True)
                
                file_path = os.path.join(upload_path, unique_filename)
                file.save(file_path)
                
                # Store relative path for markdown
                media_paths[media_type] = f"/static/uploads/{media_type}s/{unique_filename}"

        # Generate markdown frontmatter
        post = frontmatter.Post(content)
        post['title'] = title
        post['category'] = category
        post['author'] = author
        post['date'] = date_str
        if media_paths['image']: post['image'] = media_paths['image']
        if media_paths['audio']: post['audio'] = media_paths['audio']
        if media_paths['video']: post['video'] = media_paths['video']

        # Save to filesystem
        slug = slugify(title)
        filename = f"{date_str}-{slug}.md"
        filepath = os.path.join(app.root_path, "content", "articles", filename)
        
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "wb") as f:
            frontmatter.dump(post, f)

        # Sync Database
        with app.app_context():
            seed_database()

        flash("Article published to press successfully!", "success")
        return redirect(url_for('home'))

    return render_template("compose.html", now=datetime.datetime.now())

@app.route("/")
def home():
    """Render the current issue (home page) using the issue template."""
    # Get the most recent issue
    latest_issue = Issue.query.order_by(Issue.year.desc(), Issue.id.desc()).first()
    
    if latest_issue is None:
        return render_template("404.html"), 404

    # Get prev/next navigation
    prev_issue = Issue.query.filter(Issue.id < latest_issue.id).order_by(Issue.id.desc()).first()
    
    # Dynamic Layout Selection (1 to 5)
    # Use week number for deterministic rotation
    layout_index = 1
    try:
        # issue.id format: week-YYYY-MM-DD
        if latest_issue.id.startswith('week-'):
            date_str = latest_issue.id[5:]
            date_obj = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            # ISO Calendar week number
            week_num = date_obj.isocalendar()[1]
            layout_index = (week_num % 5) + 1
    except Exception as e:
        print(f"Layout selection error: {e}")
        
    template_name = f"issue_v{layout_index}.html"
    print(f"Home displaying {latest_issue.id} with layout {template_name}")

    return render_template(template_name, 
                         issue=latest_issue, 
                         prev_issue=prev_issue, 
                         next_issue=None, 
                         Article=Article, 
                         is_current_issue=True)


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
        # Sort by ID (week-YYYY-MM-DD) which is chronologically correct
        query = Issue.query.order_by(Issue.id.desc())

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
    # The issue_id is a string like "week-YYYY-MM-DD"
    issue = db.session.get(Issue, issue_id)
    if issue is None:
        return render_template("404.html"), 404

    # Get previous and next issues for navigation based on date
    prev_issue = Issue.query.filter(Issue.date < issue.date).order_by(Issue.date.desc()).first()
    next_issue = Issue.query.filter(Issue.date > issue.date).order_by(Issue.date.asc()).first()

    # Dynamic Layout Selection (1 to 5)
    layout_index = 1
    try:
        if issue.id.startswith('week-'):
            date_str = issue.id[5:]
            date_obj = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
            week_num = date_obj.isocalendar()[1]
            layout_index = (week_num % 5) + 1
    except Exception as e:
        print(f"Layout selection error: {e}")

    template_name = f"issue_v{layout_index}.html"
    print(f"Issue {issue.id} displaying layout {template_name}")

    return render_template(template_name, issue=issue, prev_issue=prev_issue, next_issue=next_issue, Article=Article, is_current_issue=False)


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


@app.route("/api/articles", methods=["POST"])
@require_api_token
def create_article():
    """API endpoint to create a new article."""
    data = request.get_json()
    
    if not data:
        return {"error": "No data provided"}, 400
        
    required_fields = ["title", "content", "category", "date"]
    for field in required_fields:
        if field not in data:
            return {"error": f"Missing required field: {field}"}, 400
            
    title = data.get("title")
    content = data.get("content")
    category = data.get("category")
    date_str = data.get("date") # Expected YYYY-MM-DD
    author = data.get("author", "Staff Writer")
    
    # Validate date format
    try:
        datetime.datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return {"error": "Invalid date format. Use YYYY-MM-DD"}, 400
        
    # Generate filename
    slug = slugify(title)
    filename = f"{date_str}-{slug}.md"
    filepath = os.path.join(app.root_path, "content", "articles", filename)
    
    # Create directory if it doesn't exist
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    # Prepare frontmatter
    post = frontmatter.Post(content, title=title, date=date_str, category=category, author=author)
    
    # Save to file
    with open(filepath, "wb") as f:
        frontmatter.dump(post, f)
        
    # Refresh database
    try:
        with app.app_context():
            seed_database()
    except Exception as e:
        return {"error": f"Article saved but database refresh failed: {str(e)}"}, 500
        
    return {
        "message": "Article created successfully",
        "filename": filename,
        "status": "success"
    }, 201


if __name__ == "__main__":
    app.run(debug=True)
