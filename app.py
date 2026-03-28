"""Albricias - A monthly AI-assisted vintage newspaper web application."""

import os
import io
import json
import datetime
import calendar
import re
from functools import wraps

from flask import (
    Flask,
    render_template,
    request,
    session,
    redirect,
    url_for,
    flash,
    abort,
    jsonify,
)
from dotenv import load_dotenv
import markdown
from werkzeug.utils import secure_filename

from models import db, Edition, Article, GitHubActivity, EDITION_STATUS_DRAFT, EDITION_STATUS_PUBLISHED

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "SQLALCHEMY_DATABASE_URI", "sqlite:///albricias.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-key")
app.config["UPLOAD_FOLDER"] = os.path.join(app.root_path, "static", "uploads")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

db.init_app(app)

# ---------------------------------------------------------------------------
# Template filters & context processors
# ---------------------------------------------------------------------------

@app.template_filter("markdown")
def markdown_filter(text):
    return markdown.markdown(text or "", extensions=["fenced_code", "tables"])


@app.context_processor
def inject_newspaper_config():
    return dict(
        newspaper={
            "name": os.getenv("NEWSPAPER_NAME", "¡Albricias!"),
            "tagline": os.getenv("NEWSPAPER_TAGLINE", "All the News That's Fit to Print"),
            "price": os.getenv("NEWSPAPER_PRICE", "Two Cents"),
            "metadata_right": os.getenv("NEWSPAPER_METADATA_RIGHT", ""),
        },
        now=datetime.datetime.now(),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text


def require_api_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = os.getenv("API_TOKEN")
        if token:
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or auth.split(" ", 1)[1] != token:
                return {"error": "Unauthorized"}, 401
        return f(*args, **kwargs)
    return decorated


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login", next=request.url))
        return f(*args, **kwargs)
    return decorated


def _layout_index(edition: Edition) -> int:
    """Deterministic layout (1–5) based on edition month."""
    return (edition.month % 5) + 1


def _save_media_file(file_obj, media_type: str, edition_prefix: str) -> str | None:
    """Save an uploaded image or audio file, returning the web path."""
    if not file_obj or file_obj.filename == "":
        return None
    filename = secure_filename(file_obj.filename)
    base, ext = os.path.splitext(filename)
    unique_name = f"{edition_prefix}-{slugify(base)}{ext}"
    folder = os.path.join(app.config["UPLOAD_FOLDER"], media_type + "s")
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, unique_name)

    if media_type == "image":
        try:
            from PIL import Image
            img = Image.open(file_obj)
            max_width = 1200
            if img.width > max_width:
                ratio = max_width / img.width
                img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)
            # Convert to RGB for JPEG saving
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
                base_no_ext = os.path.splitext(unique_name)[0]
                unique_name = base_no_ext + ".jpg"
                dest = os.path.join(folder, unique_name)
            img.save(dest, "JPEG", quality=80, optimize=True)
        except ImportError:
            file_obj.seek(0)
            file_obj.save(dest)
        except Exception:
            file_obj.seek(0)
            file_obj.save(dest)
    else:
        file_obj.save(dest)

    return f"/static/uploads/{media_type}s/{unique_name}"


# ---------------------------------------------------------------------------
# App startup — create tables (no seeding from files)
# ---------------------------------------------------------------------------

with app.app_context():
    db.create_all()


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        password = request.form.get("password")
        if password == os.getenv("ADMIN_PASSWORD", "admin"):
            session["logged_in"] = True
            return redirect(request.args.get("next") or url_for("home"))
        flash("Invalid password", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.pop("logged_in", None)
    return redirect(url_for("home"))


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    latest = (
        Edition.query
        .filter_by(status=EDITION_STATUS_PUBLISHED)
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )
    if latest is None:
        return render_template("404.html"), 404

    prev_edition = (
        Edition.query
        .filter(
            Edition.status == EDITION_STATUS_PUBLISHED,
            db.or_(
                Edition.year < latest.year,
                db.and_(Edition.year == latest.year, Edition.month < latest.month),
            ),
        )
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )

    template = f"issue_v{_layout_index(latest)}.html"
    return render_template(
        template,
        issue=latest,
        prev_issue=prev_edition,
        next_issue=None,
        Article=Article,
        is_current_issue=True,
        is_preview=False,
    )


@app.route("/archive")
def archive():
    selected_year = request.args.get("year", "All Years")
    view_mode = request.args.get("view", "issues")
    page = request.args.get("page", 1, type=int)
    per_page = 8

    years_result = (
        db.session.query(Edition.year)
        .filter_by(status=EDITION_STATUS_PUBLISHED)
        .distinct()
        .order_by(Edition.year.desc())
        .all()
    )
    years = ["All Years"] + [str(y[0]) for y in years_result]

    if view_mode == "articles":
        query = (
            Article.query
            .join(Edition)
            .filter(Edition.status == EDITION_STATUS_PUBLISHED)
            .order_by(Edition.year.desc(), Edition.month.desc(), Article.order)
        )
        if selected_year != "All Years":
            try:
                query = query.filter(Edition.year == int(selected_year))
            except ValueError:
                pass

        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        categories = [
            c[0]
            for c in db.session.query(Article.category).distinct().order_by(Article.category).all()
        ]
        return render_template(
            "archive.html",
            items=pagination.items,
            years=years,
            selected_year=selected_year,
            view_mode=view_mode,
            pagination=pagination,
            categories=categories,
        )
    else:
        query = (
            Edition.query
            .filter_by(status=EDITION_STATUS_PUBLISHED)
            .order_by(Edition.year.desc(), Edition.month.desc())
        )
        if selected_year != "All Years":
            try:
                query = query.filter(Edition.year == int(selected_year))
            except ValueError:
                pass

        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        return render_template(
            "archive.html",
            items=pagination.items,
            years=years,
            selected_year=selected_year,
            view_mode=view_mode,
            pagination=pagination,
            categories=[],
        )


@app.route("/edition/<int:edition_id>")
def edition_detail(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None or not edition.is_published:
        return render_template("404.html"), 404

    prev_edition = (
        Edition.query
        .filter(
            Edition.status == EDITION_STATUS_PUBLISHED,
            db.or_(
                Edition.year < edition.year,
                db.and_(Edition.year == edition.year, Edition.month < edition.month),
            ),
        )
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )
    next_edition = (
        Edition.query
        .filter(
            Edition.status == EDITION_STATUS_PUBLISHED,
            db.or_(
                Edition.year > edition.year,
                db.and_(Edition.year == edition.year, Edition.month > edition.month),
            ),
        )
        .order_by(Edition.year.asc(), Edition.month.asc())
        .first()
    )

    template = f"issue_v{_layout_index(edition)}.html"
    return render_template(
        template,
        issue=edition,
        prev_issue=prev_edition,
        next_issue=next_edition,
        Article=Article,
        is_current_issue=False,
        is_preview=False,
    )


@app.route("/article/<int:article_id>")
def article_detail(article_id):
    article = db.session.get(Article, article_id)
    if article is None or not article.edition.is_published:
        return render_template("404.html"), 404

    prev_article = (
        Article.query
        .filter(Article.edition_id == article.edition_id, Article.order < article.order)
        .order_by(Article.order.desc())
        .first()
    )
    next_article = (
        Article.query
        .filter(Article.edition_id == article.edition_id, Article.order > article.order)
        .order_by(Article.order.asc())
        .first()
    )
    return render_template(
        "article.html",
        article=article,
        prev_article=prev_article,
        next_article=next_article,
    )


# ---------------------------------------------------------------------------
# Compose route (manual article entry — saves directly to DB)
# ---------------------------------------------------------------------------

@app.route("/compose", methods=["GET", "POST"])
@login_required
def compose_article():
    editions = (
        Edition.query.order_by(Edition.year.desc(), Edition.month.desc()).all()
    )
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        category = request.form.get("category", "General")
        author = request.form.get("author", "Staff Writer").strip()
        date_str = request.form.get("date", "")
        content = request.form.get("content", "").strip()
        edition_id = request.form.get("edition_id", "")
        video_url = request.form.get("video_url", "").strip()

        if not title or not content:
            flash("Headline and Narrative are required!", "error")
            return redirect(url_for("compose_article"))

        # Resolve edition
        target_edition = None
        if edition_id:
            target_edition = db.session.get(Edition, int(edition_id))

        if target_edition is None:
            # Create a new edition for the given date's month
            try:
                article_date = datetime.date.fromisoformat(date_str)
            except ValueError:
                article_date = datetime.date.today()

            target_edition = Edition.query.filter_by(
                year=article_date.year, month=article_date.month
            ).first()

            if target_edition is None:
                month_name = calendar.month_name[article_date.month]
                target_edition = Edition(
                    month=article_date.month,
                    year=article_date.year,
                    title=f"{month_name} {article_date.year}",
                    status=EDITION_STATUS_DRAFT,
                    vol=f"VOL. {article_date.year} NO. {article_date.month}",
                )
                db.session.add(target_edition)
                db.session.flush()

        # Media uploads
        edition_prefix = f"{target_edition.year}-{target_edition.month:02d}"
        image_path = _save_media_file(request.files.get("image"), "image", edition_prefix)
        audio_path = _save_media_file(request.files.get("audio"), "audio", edition_prefix)

        # Determine order within edition
        max_order = (
            db.session.query(db.func.max(Article.order))
            .filter_by(edition_id=target_edition.id)
            .scalar()
        )
        next_order = (max_order or 0) + 1

        try:
            article_date_obj = datetime.date.fromisoformat(date_str)
        except ValueError:
            article_date_obj = datetime.date.today()

        article = Article(
            edition_id=target_edition.id,
            title=title,
            content=content,
            category=category,
            author=author,
            deck=content[0] if content else "A",
            order=next_order,
            date=article_date_obj,
            image=image_path,
            audio=audio_path,
            video=video_url or None,
            source_type="manual",
        )
        db.session.add(article)
        db.session.commit()

        flash("Article saved to press successfully!", "success")
        return redirect(url_for("admin_edition_edit", edition_id=target_edition.id))

    return render_template("compose.html", now=datetime.datetime.now(), editions=editions)


# ---------------------------------------------------------------------------
# Admin routes
# ---------------------------------------------------------------------------

@app.route("/admin")
@login_required
def admin_index():
    return redirect(url_for("admin_editions"))


@app.route("/admin/editions")
@login_required
def admin_editions():
    drafts = (
        Edition.query
        .filter_by(status=EDITION_STATUS_DRAFT)
        .order_by(Edition.year.desc(), Edition.month.desc())
        .all()
    )
    published = (
        Edition.query
        .filter_by(status=EDITION_STATUS_PUBLISHED)
        .order_by(Edition.year.desc(), Edition.month.desc())
        .all()
    )
    return render_template("admin/editions.html", drafts=drafts, published=published)


@app.route("/admin/editions/new", methods=["GET", "POST"])
@login_required
def admin_edition_new():
    """Create a blank draft edition for a given month/year."""
    if request.method == "POST":
        try:
            month = int(request.form["month"])
            year = int(request.form["year"])
        except (KeyError, ValueError):
            flash("Invalid month or year.", "error")
            return redirect(url_for("admin_editions"))

        existing = Edition.query.filter_by(year=year, month=month).first()
        if existing:
            flash(f"An edition for {calendar.month_name[month]} {year} already exists.", "error")
            return redirect(url_for("admin_edition_edit", edition_id=existing.id))

        month_name = calendar.month_name[month]
        edition = Edition(
            month=month,
            year=year,
            title=f"{month_name} {year}",
            status=EDITION_STATUS_DRAFT,
            vol=f"VOL. {year} NO. {month}",
        )
        db.session.add(edition)
        db.session.commit()
        flash(f"Draft edition '{edition.title}' created.", "success")
        return redirect(url_for("admin_edition_edit", edition_id=edition.id))

    return render_template("admin/edition_new.html", now=datetime.datetime.now())


@app.route("/admin/editions/generate", methods=["POST"])
@login_required
def admin_edition_generate():
    """Fetch GitHub data + run AI writer to generate a new monthly draft edition."""
    try:
        month = int(request.form["month"])
        year = int(request.form["year"])
    except (KeyError, ValueError):
        flash("Invalid month or year.", "error")
        return redirect(url_for("admin_editions"))

    existing = Edition.query.filter_by(year=year, month=month).first()
    if existing:
        flash(f"An edition for {calendar.month_name[month]} {year} already exists. Editing it instead.", "info")
        return redirect(url_for("admin_edition_edit", edition_id=existing.id))

    # Create edition
    month_name = calendar.month_name[month]
    edition = Edition(
        month=month,
        year=year,
        title=f"{month_name} {year}",
        status=EDITION_STATUS_DRAFT,
        vol=f"VOL. {year} NO. {month}",
    )
    db.session.add(edition)
    db.session.flush()

    # Fetch GitHub activity
    github_token = os.getenv("GITHUB_TOKEN")
    github_username = os.getenv("GITHUB_USERNAME")
    fetched_count = 0

    if github_token and github_username:
        try:
            from services.github import fetch_monthly_activity
            activities = fetch_monthly_activity(github_username, year, month, github_token)
            for act in activities:
                ga = GitHubActivity(
                    edition_id=edition.id,
                    event_type=act["event_type"],
                    repo=act.get("repo"),
                    title=act.get("title", ""),
                    url=act.get("url"),
                    timestamp=act.get("timestamp"),
                    raw_json=json.dumps(act.get("raw", {})),
                )
                db.session.add(ga)
            fetched_count = len(activities)
        except Exception as e:
            flash(f"GitHub fetch warning: {e}", "warning")
    else:
        flash("GITHUB_TOKEN or GITHUB_USERNAME not configured — skipping GitHub fetch.", "warning")

    db.session.flush()

    # Generate AI articles
    openai_key = os.getenv("OPENAI_API_KEY")
    generated_count = 0

    if openai_key and fetched_count > 0:
        try:
            from services.ai_writer import generate_edition_draft
            articles = generate_edition_draft(edition.id, openai_key)
            generated_count = len(articles)
        except Exception as e:
            flash(f"AI writer warning: {e}", "warning")
    elif fetched_count == 0:
        flash("No GitHub activity fetched — AI generation skipped.", "info")
    else:
        flash("OPENAI_API_KEY not configured — AI generation skipped.", "warning")

    db.session.commit()
    flash(
        f"Draft edition '{edition.title}' created with {fetched_count} GitHub events "
        f"and {generated_count} AI-generated articles.",
        "success",
    )
    return redirect(url_for("admin_edition_edit", edition_id=edition.id))


@app.route("/admin/editions/<int:edition_id>/edit", methods=["GET", "POST"])
@login_required
def admin_edition_edit(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    if request.method == "POST":
        edition.title = request.form.get("title", edition.title).strip()
        edition.vol = request.form.get("vol", edition.vol).strip()
        cover_file = request.files.get("cover_image")
        if cover_file and cover_file.filename:
            prefix = f"{edition.year}-{edition.month:02d}-cover"
            edition.cover_image = _save_media_file(cover_file, "image", prefix)
        cover_url = request.form.get("cover_image_url", "").strip()
        if cover_url and not (cover_file and cover_file.filename):
            edition.cover_image = cover_url
        db.session.commit()
        flash("Edition metadata updated.", "success")
        return redirect(url_for("admin_edition_edit", edition_id=edition.id))

    articles = edition.articles.order_by(Article.order).all()
    return render_template("admin/edition_edit.html", edition=edition, articles=articles)


@app.route("/admin/editions/<int:edition_id>/preview")
@login_required
def admin_edition_preview(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    prev_edition = (
        Edition.query
        .filter(
            db.or_(
                Edition.year < edition.year,
                db.and_(Edition.year == edition.year, Edition.month < edition.month),
            )
        )
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )
    next_edition = (
        Edition.query
        .filter(
            db.or_(
                Edition.year > edition.year,
                db.and_(Edition.year == edition.year, Edition.month > edition.month),
            )
        )
        .order_by(Edition.year.asc(), Edition.month.asc())
        .first()
    )

    template = f"issue_v{_layout_index(edition)}.html"
    return render_template(
        template,
        issue=edition,
        prev_issue=prev_edition,
        next_issue=next_edition,
        Article=Article,
        is_current_issue=False,
        is_preview=True,
    )


@app.route("/admin/editions/<int:edition_id>/publish", methods=["POST"])
@login_required
def admin_edition_publish(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)
    edition.status = EDITION_STATUS_PUBLISHED
    edition.published_at = datetime.datetime.utcnow()
    db.session.commit()
    flash(f"Edition '{edition.title}' is now published.", "success")
    return redirect(url_for("admin_editions"))


@app.route("/admin/editions/<int:edition_id>/unpublish", methods=["POST"])
@login_required
def admin_edition_unpublish(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)
    edition.status = EDITION_STATUS_DRAFT
    edition.published_at = None
    db.session.commit()
    flash(f"Edition '{edition.title}' moved back to draft.", "success")
    return redirect(url_for("admin_editions"))


@app.route("/admin/editions/<int:edition_id>/delete", methods=["POST"])
@login_required
def admin_edition_delete(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)
    title = edition.title
    db.session.delete(edition)
    db.session.commit()
    flash(f"Edition '{title}' deleted.", "success")
    return redirect(url_for("admin_editions"))


@app.route("/admin/editions/<int:edition_id>/articles/add", methods=["POST"])
@login_required
def admin_article_add(edition_id):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    title = request.form.get("title", "").strip()
    content = request.form.get("content", "").strip()
    category = request.form.get("category", "General")
    author = request.form.get("author", "Staff Writer").strip()
    video_url = request.form.get("video_url", "").strip()
    date_str = request.form.get("date", "")

    if not title or not content:
        flash("Title and content are required.", "error")
        return redirect(url_for("admin_edition_edit", edition_id=edition_id))

    edition_prefix = f"{edition.year}-{edition.month:02d}"
    image_path = _save_media_file(request.files.get("image"), "image", edition_prefix)
    audio_path = _save_media_file(request.files.get("audio"), "audio", edition_prefix)

    max_order = (
        db.session.query(db.func.max(Article.order))
        .filter_by(edition_id=edition.id)
        .scalar()
    )
    try:
        article_date = datetime.date.fromisoformat(date_str)
    except ValueError:
        article_date = datetime.date(edition.year, edition.month, 1)

    article = Article(
        edition_id=edition.id,
        title=title,
        content=content,
        category=category,
        author=author,
        deck=content[0] if content else "A",
        order=(max_order or 0) + 1,
        date=article_date,
        image=image_path,
        audio=audio_path,
        video=video_url or None,
        source_type="manual",
    )
    db.session.add(article)
    db.session.commit()
    flash("Article added.", "success")
    return redirect(url_for("admin_edition_edit", edition_id=edition_id))


@app.route(
    "/admin/editions/<int:edition_id>/articles/<int:article_id>/edit",
    methods=["GET", "POST"],
)
@login_required
def admin_article_edit(edition_id, article_id):
    edition = db.session.get(Edition, edition_id)
    article = db.session.get(Article, article_id)
    if edition is None or article is None or article.edition_id != edition_id:
        abort(404)

    if request.method == "POST":
        article.title = request.form.get("title", article.title).strip()
        article.content = request.form.get("content", article.content)
        article.category = request.form.get("category", article.category)
        article.author = request.form.get("author", article.author).strip()
        article.deck = request.form.get("deck", article.deck).strip()[:1] or "A"
        try:
            article.order = int(request.form.get("order", article.order))
        except ValueError:
            pass
        article.video = request.form.get("video_url", "").strip() or None
        date_str = request.form.get("date", "")
        try:
            article.date = datetime.date.fromisoformat(date_str)
        except ValueError:
            pass

        edition_prefix = f"{edition.year}-{edition.month:02d}"
        new_image = _save_media_file(request.files.get("image"), "image", edition_prefix)
        if new_image:
            article.image = new_image
        new_audio = _save_media_file(request.files.get("audio"), "audio", edition_prefix)
        if new_audio:
            article.audio = new_audio

        article.updated_at = datetime.datetime.utcnow()
        db.session.commit()
        flash("Article updated.", "success")
        return redirect(url_for("admin_edition_edit", edition_id=edition_id))

    return render_template("admin/article_edit.html", edition=edition, article=article)


@app.route(
    "/admin/editions/<int:edition_id>/articles/<int:article_id>/delete",
    methods=["POST"],
)
@login_required
def admin_article_delete(edition_id, article_id):
    article = db.session.get(Article, article_id)
    if article is None or article.edition_id != edition_id:
        abort(404)
    db.session.delete(article)
    db.session.commit()
    flash("Article deleted.", "success")
    return redirect(url_for("admin_edition_edit", edition_id=edition_id))


@app.route(
    "/admin/editions/<int:edition_id>/articles/<int:article_id>/regenerate",
    methods=["POST"],
)
@login_required
def admin_article_regenerate(edition_id, article_id):
    """Re-run AI generation for a single article using its stored source data."""
    article = db.session.get(Article, article_id)
    if article is None or article.edition_id != edition_id:
        abort(404)

    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        flash("OPENAI_API_KEY not configured.", "error")
        return redirect(url_for("admin_edition_edit", edition_id=edition_id))

    try:
        from services.ai_writer import regenerate_article
        regenerate_article(article, openai_key)
        db.session.commit()
        flash("Article regenerated by AI.", "success")
    except Exception as e:
        flash(f"AI regeneration failed: {e}", "error")

    return redirect(url_for("admin_article_edit", edition_id=edition_id, article_id=article_id))


# ---------------------------------------------------------------------------
# Legacy /issue/<id> redirect (backward compatibility)
# ---------------------------------------------------------------------------

@app.route("/issue/<path:issue_id>")
def issue_detail(issue_id):
    """Backward compatibility: redirect old week-YYYY-MM-DD URLs."""
    return redirect(url_for("archive"), code=301)


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.route("/api/articles", methods=["POST"])
@require_api_token
def api_create_article():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    for field in ("title", "content", "category", "date"):
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    try:
        article_date = datetime.date.fromisoformat(data["date"])
    except ValueError:
        return jsonify({"error": "Invalid date format, use YYYY-MM-DD"}), 400

    edition = Edition.query.filter_by(year=article_date.year, month=article_date.month).first()
    if edition is None:
        month_name = calendar.month_name[article_date.month]
        edition = Edition(
            month=article_date.month,
            year=article_date.year,
            title=f"{month_name} {article_date.year}",
            status=EDITION_STATUS_DRAFT,
            vol=f"VOL. {article_date.year} NO. {article_date.month}",
        )
        db.session.add(edition)
        db.session.flush()

    max_order = (
        db.session.query(db.func.max(Article.order))
        .filter_by(edition_id=edition.id)
        .scalar()
    )
    content = data.get("content", "")
    article = Article(
        edition_id=edition.id,
        title=data["title"],
        content=content,
        category=data["category"],
        author=data.get("author", "Staff Writer"),
        deck=content[0] if content else "A",
        order=(max_order or 0) + 1,
        date=article_date,
        source_type="manual",
    )
    db.session.add(article)
    db.session.commit()
    return jsonify({"message": "Article created", "article_id": article.id, "edition_id": edition.id}), 201


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404


if __name__ == "__main__":
    app.run(debug=True)
