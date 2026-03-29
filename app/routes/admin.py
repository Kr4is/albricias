"""Admin routes — edition and article management (all require login)."""

import os
import json
import datetime
import calendar

from flask import (
    Blueprint,
    render_template,
    request,
    redirect,
    url_for,
    flash,
    abort,
)

from app.auth import login_required
from app.extensions import db
from app.helpers import layout_index, save_media_file
from app.models import (
    Edition,
    Article,
    ServiceActivity,
    EDITION_STATUS_DRAFT,
    EDITION_STATUS_PUBLISHED,
)

admin_bp = Blueprint("admin", __name__)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@admin_bp.route("/")
@login_required
def index():
    return redirect(url_for("admin.editions"))


@admin_bp.route("/editions")
@login_required
def editions():
    drafts = (
        Edition.query.filter_by(status=EDITION_STATUS_DRAFT)
        .order_by(Edition.year.desc(), Edition.month.desc())
        .all()
    )
    published = (
        Edition.query.filter_by(status=EDITION_STATUS_PUBLISHED)
        .order_by(Edition.year.desc(), Edition.month.desc())
        .all()
    )
    return render_template("admin/editions.html", drafts=drafts, published=published)


# ---------------------------------------------------------------------------
# Create / Generate editions
# ---------------------------------------------------------------------------


@admin_bp.route("/editions/new", methods=["GET", "POST"])
@login_required
def edition_new():
    """Create a blank draft edition."""
    if request.method == "POST":
        try:
            month = int(request.form["month"])
            year = int(request.form["year"])
        except (KeyError, ValueError):
            flash("Invalid month or year.", "error")
            return redirect(url_for("admin.editions"))

        existing = Edition.query.filter_by(year=year, month=month).first()
        if existing:
            flash(
                f"An edition for {calendar.month_name[month]} {year} already exists.",
                "error",
            )
            return redirect(url_for("admin.edition_edit", edition_id=existing.id))

        edition = Edition(
            month=month,
            year=year,
            title=f"{calendar.month_name[month]} {year}",
            status=EDITION_STATUS_DRAFT,
            vol=f"VOL. {year} NO. {month}",
        )
        db.session.add(edition)
        db.session.commit()
        flash(f"Draft edition '{edition.title}' created.", "success")
        return redirect(url_for("admin.edition_edit", edition_id=edition.id))

    return render_template("admin/edition_new.html", now=datetime.datetime.now())


@admin_bp.route("/editions/generate", methods=["POST"])
@login_required
def edition_generate():
    """Fetch GitHub data + run AI writer to produce a monthly draft."""
    try:
        month = int(request.form["month"])
        year = int(request.form["year"])
    except (KeyError, ValueError):
        flash("Invalid month or year.", "error")
        return redirect(url_for("admin.editions"))

    existing = Edition.query.filter_by(year=year, month=month).first()
    if existing:
        flash(
            f"An edition for {calendar.month_name[month]} {year} already exists.",
            "info",
        )
        return redirect(url_for("admin.edition_edit", edition_id=existing.id))

    edition = Edition(
        month=month,
        year=year,
        title=f"{calendar.month_name[month]} {year}",
        status=EDITION_STATUS_DRAFT,
        vol=f"VOL. {year} NO. {month}",
    )
    db.session.add(edition)
    db.session.flush()

    # --- GitHub fetch ---
    github_token = os.getenv("GITHUB_TOKEN")
    github_username = os.getenv("GITHUB_USERNAME")
    fetched_count = 0

    if github_token and github_username:
        try:
            from app.services.github import fetch_monthly_activity

            activities = fetch_monthly_activity(
                github_username, year, month, github_token
            )
            for act in activities:
                db.session.add(
                    ServiceActivity(
                        edition_id=edition.id,
                        source="github",
                        event_type=act["event_type"],
                        repo=act.get("repo"),
                        title=act.get("title", ""),
                        url=act.get("url"),
                        timestamp=act.get("timestamp"),
                        raw_json=json.dumps(act.get("raw", {})),
                    )
                )
            fetched_count = len(activities)
        except Exception as exc:
            flash(f"GitHub fetch warning: {exc}", "warning")
    else:
        flash(
            "GITHUB_TOKEN or GITHUB_USERNAME not configured — skipping GitHub fetch.",
            "warning",
        )

    db.session.flush()

    # --- Spotify fetch ---
    spotify_fetched = 0
    from app.models import ServiceToken

    spotify_token = ServiceToken.get("spotify")
    if spotify_token:
        try:
            from app.services.spotify import refresh_access_token, fetch_monthly_listening

            if spotify_token.is_expired and spotify_token.refresh_token:
                token_data = refresh_access_token(spotify_token.refresh_token)
                ServiceToken.upsert(
                    service="spotify",
                    access_token=token_data["access_token"],
                    refresh_token=token_data.get("refresh_token"),
                    expires_in=token_data.get("expires_in"),
                )
                db.session.flush()
                spotify_token = ServiceToken.get("spotify")

            spotify_items = fetch_monthly_listening(spotify_token.access_token)
            for item in spotify_items:
                db.session.add(
                    ServiceActivity(
                        edition_id=edition.id,
                        source="spotify",
                        event_type=item["event_type"],
                        repo=None,
                        title=item.get("title", ""),
                        url=item.get("url"),
                        timestamp=item.get("timestamp"),
                        raw_json=json.dumps(item.get("raw", {})),
                    )
                )
            spotify_fetched = len(spotify_items)
            fetched_count += spotify_fetched
        except Exception as exc:
            flash(f"Spotify fetch warning: {exc}", "warning")
    else:
        flash(
            "Spotify not connected — visit /admin/spotify/connect to link your account.",
            "info",
        )

    db.session.flush()

    # --- AI generation ---
    openai_key = os.getenv("OPENAI_API_KEY")
    generated_count = 0

    if openai_key and fetched_count > 0:
        try:
            from app.services.ai_writer import generate_edition_draft

            articles = generate_edition_draft(edition.id, openai_key)
            generated_count = len(articles)
        except Exception as exc:
            flash(f"AI writer warning: {exc}", "warning")
    elif fetched_count == 0:
        flash("No activity fetched from any service — AI generation skipped.", "info")
    else:
        flash("OPENAI_API_KEY not configured — AI generation skipped.", "warning")

    db.session.commit()
    flash(
        f"Draft edition '{edition.title}' created with "
        f"{fetched_count - spotify_fetched} GitHub events, "
        f"{spotify_fetched} Spotify items, "
        f"and {generated_count} AI-generated articles.",
        "success",
    )
    return redirect(url_for("admin.edition_edit", edition_id=edition.id))


# ---------------------------------------------------------------------------
# Edit edition metadata
# ---------------------------------------------------------------------------


@admin_bp.route("/editions/<int:edition_id>/edit", methods=["GET", "POST"])
@login_required
def edition_edit(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    if request.method == "POST":
        edition.title = request.form.get("title", edition.title).strip()
        edition.vol = request.form.get("vol", edition.vol).strip()

        prefix = f"{edition.year}-{edition.month:02d}-cover"
        cover_file = request.files.get("cover_image")
        if cover_file and cover_file.filename:
            edition.cover_image = save_media_file(cover_file, "image", prefix)
        else:
            cover_url = request.form.get("cover_image_url", "").strip()
            if cover_url:
                edition.cover_image = cover_url

        db.session.commit()
        flash("Edition metadata updated.", "success")
        return redirect(url_for("admin.edition_edit", edition_id=edition.id))

    articles = edition.articles.order_by(Article.order).all()
    return render_template(
        "admin/edition_edit.html", edition=edition, articles=articles
    )


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


@admin_bp.route("/editions/<int:edition_id>/preview")
@login_required
def edition_preview(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    prev_edition = (
        Edition.query.filter(
            db.or_(
                Edition.year < edition.year,
                db.and_(
                    Edition.year == edition.year, Edition.month < edition.month
                ),
            )
        )
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )
    next_edition = (
        Edition.query.filter(
            db.or_(
                Edition.year > edition.year,
                db.and_(
                    Edition.year == edition.year, Edition.month > edition.month
                ),
            )
        )
        .order_by(Edition.year.asc(), Edition.month.asc())
        .first()
    )

    template = f"issue_v{layout_index(edition)}.html"
    return render_template(
        template,
        issue=edition,
        prev_issue=prev_edition,
        next_issue=next_edition,
        Article=Article,
        is_current_issue=False,
        is_preview=True,
    )


# ---------------------------------------------------------------------------
# Publish / Unpublish / Delete edition
# ---------------------------------------------------------------------------


@admin_bp.route("/editions/<int:edition_id>/publish", methods=["POST"])
@login_required
def edition_publish(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)
    edition.status = EDITION_STATUS_PUBLISHED
    edition.published_at = datetime.datetime.utcnow()
    db.session.commit()
    flash(f"Edition '{edition.title}' is now published.", "success")
    return redirect(url_for("admin.editions"))


@admin_bp.route("/editions/<int:edition_id>/unpublish", methods=["POST"])
@login_required
def edition_unpublish(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)
    edition.status = EDITION_STATUS_DRAFT
    edition.published_at = None
    db.session.commit()
    flash(f"Edition '{edition.title}' moved back to draft.", "success")
    return redirect(url_for("admin.editions"))


@admin_bp.route("/editions/<int:edition_id>/delete", methods=["POST"])
@login_required
def edition_delete(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)
    title = edition.title
    db.session.delete(edition)
    db.session.commit()
    flash(f"Edition '{title}' deleted.", "success")
    return redirect(url_for("admin.editions"))


# ---------------------------------------------------------------------------
# Articles — add, edit, delete, regenerate
# ---------------------------------------------------------------------------


def _next_order(edition_id: int) -> int:
    """Return the next available order value for an edition."""
    max_order = (
        db.session.query(db.func.max(Article.order))
        .filter_by(edition_id=edition_id)
        .scalar()
    )
    return (max_order or 0) + 1


@admin_bp.route("/editions/<int:edition_id>/articles/add", methods=["POST"])
@login_required
def article_add(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    title = request.form.get("title", "").strip()
    content = request.form.get("content", "").strip()
    if not title or not content:
        flash("Title and content are required.", "error")
        return redirect(url_for("admin.edition_edit", edition_id=edition_id))

    prefix = f"{edition.year}-{edition.month:02d}"
    date_str = request.form.get("date", "")
    try:
        article_date = datetime.date.fromisoformat(date_str)
    except ValueError:
        article_date = datetime.date(edition.year, edition.month, 1)

    article = Article(
        edition_id=edition.id,
        title=title,
        content=content,
        category=request.form.get("category", "General"),
        author=request.form.get("author", "Staff Writer").strip(),
        deck=content[0] if content else "A",
        order=_next_order(edition.id),
        date=article_date,
        image=save_media_file(request.files.get("image"), "image", prefix),
        audio=save_media_file(request.files.get("audio"), "audio", prefix),
        video=request.form.get("video_url", "").strip() or None,
        source_type="manual",
    )
    db.session.add(article)
    db.session.commit()
    flash("Article added.", "success")
    return redirect(url_for("admin.edition_edit", edition_id=edition_id))


@admin_bp.route(
    "/editions/<int:edition_id>/articles/<int:article_id>/edit",
    methods=["GET", "POST"],
)
@login_required
def article_edit(edition_id: int, article_id: int):
    edition = db.session.get(Edition, edition_id)
    article = db.session.get(Article, article_id)
    if edition is None or article is None or article.edition_id != edition_id:
        abort(404)

    if request.method == "POST":
        article.title = request.form.get("title", article.title).strip()
        article.content = request.form.get("content", article.content)
        article.category = request.form.get("category", article.category)
        article.author = request.form.get("author", article.author).strip()
        article.deck = (request.form.get("deck", article.deck).strip()[:1] or "A")
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

        prefix = f"{edition.year}-{edition.month:02d}"
        new_image = save_media_file(request.files.get("image"), "image", prefix)
        if new_image:
            article.image = new_image
        new_audio = save_media_file(request.files.get("audio"), "audio", prefix)
        if new_audio:
            article.audio = new_audio

        article.updated_at = datetime.datetime.utcnow()
        db.session.commit()
        flash("Article updated.", "success")
        return redirect(url_for("admin.edition_edit", edition_id=edition_id))

    return render_template(
        "admin/article_edit.html", edition=edition, article=article
    )


@admin_bp.route(
    "/editions/<int:edition_id>/articles/<int:article_id>/delete",
    methods=["POST"],
)
@login_required
def article_delete(edition_id: int, article_id: int):
    article = db.session.get(Article, article_id)
    if article is None or article.edition_id != edition_id:
        abort(404)
    db.session.delete(article)
    db.session.commit()
    flash("Article deleted.", "success")
    return redirect(url_for("admin.edition_edit", edition_id=edition_id))


@admin_bp.route(
    "/editions/<int:edition_id>/articles/<int:article_id>/regenerate",
    methods=["POST"],
)
@login_required
def article_regenerate(edition_id: int, article_id: int):
    """Re-run AI generation for a single article."""
    article = db.session.get(Article, article_id)
    if article is None or article.edition_id != edition_id:
        abort(404)

    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        flash("OPENAI_API_KEY not configured.", "error")
        return redirect(url_for("admin.edition_edit", edition_id=edition_id))

    try:
        from app.services.ai_writer import regenerate_article

        regenerate_article(article, openai_key)
        db.session.commit()
        flash("Article regenerated by AI.", "success")
    except Exception as exc:
        flash(f"AI regeneration failed: {exc}", "error")

    return redirect(
        url_for("admin.article_edit", edition_id=edition_id, article_id=article_id)
    )


# ---------------------------------------------------------------------------
# Assisted content generation
# ---------------------------------------------------------------------------

ARTICLE_CATEGORIES = [
    "Front Page", "Politics", "Business", "Arts & Letters",
    "Open Source", "Project Updates", "Community", "Technology",
    "Obituaries", "Editorial", "General",
]


@admin_bp.route(
    "/editions/<int:edition_id>/articles/generate",
    methods=["GET", "POST"],
)
@login_required
def article_generate(edition_id: int):
    """Show and process the assisted article generation form."""
    edition = db.session.get(Edition, edition_id)
    if edition is None:
        abort(404)

    if request.method == "GET":
        from app.services.sources import SOURCES
        from app.services.generators import GENERATORS

        return render_template(
            "admin/article_generate.html",
            edition=edition,
            sources=SOURCES,
            generators=GENERATORS,
        )

    # POST — run the pipeline
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        flash("OPENAI_API_KEY is not configured.", "error")
        return redirect(url_for("admin.edition_edit", edition_id=edition_id))

    source_type = request.form.get("source_type", "")
    generator_type = request.form.get("generator_type", "")

    if not source_type or not generator_type:
        flash("Please select both a source type and an article type.", "error")
        return redirect(url_for("admin.article_generate", edition_id=edition_id))

    # Collect inputs depending on source type
    audio_file = None
    audio_filename = ""
    text_input = ""

    if source_type.startswith("audio_"):
        audio_file = request.files.get("audio_file")
        if not audio_file or not audio_file.filename:
            flash("Please upload an audio file.", "error")
            return redirect(url_for("admin.article_generate", edition_id=edition_id))
        audio_filename = audio_file.filename
    else:
        text_input = request.form.get("text_input", "").strip()
        if not text_input:
            flash("Please paste some text or notes.", "error")
            return redirect(url_for("admin.article_generate", edition_id=edition_id))

    # Optional generator hints
    topic_hint = request.form.get("topic_hint", "").strip()
    subject_name = request.form.get("subject_name", "").strip()
    subject_type = request.form.get("subject_type", "other").strip()
    interviewee_name = request.form.get("interviewee_name", "").strip()
    author = request.form.get("author", "The Albricias Correspondent").strip() or "The Albricias Correspondent"

    date_str = request.form.get("date", "")
    try:
        article_date = datetime.date.fromisoformat(date_str)
    except ValueError:
        article_date = datetime.date(edition.year, edition.month, 1)

    try:
        from app.services.ai_writer import generate_article_from_source

        article = generate_article_from_source(
            edition_id=edition_id,
            source_type=source_type,
            generator_type=generator_type,
            api_key=openai_key,
            audio_file=audio_file,
            audio_filename=audio_filename,
            text_input=text_input,
            topic_hint=topic_hint,
            subject_name=subject_name,
            subject_type=subject_type,
            interviewee_name=interviewee_name,
            article_date=article_date,
            author=author,
        )
        db.session.commit()
        flash("Article generated successfully. Review and save your changes below.", "success")
        return redirect(
            url_for("admin.article_edit", edition_id=edition_id, article_id=article.id)
        )
    except Exception as exc:
        db.session.rollback()
        flash(f"Generation failed: {exc}", "error")
        return redirect(url_for("admin.article_generate", edition_id=edition_id))


# ---------------------------------------------------------------------------
# Spotify OAuth
# ---------------------------------------------------------------------------


@admin_bp.route("/spotify/connect")
@login_required
def spotify_connect():
    """Redirect the admin to Spotify's authorization page."""
    if not os.getenv("SPOTIFY_CLIENT_ID") or not os.getenv("SPOTIFY_CLIENT_SECRET"):
        flash(
            "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env "
            "before connecting Spotify.",
            "error",
        )
        return redirect(url_for("admin.editions"))

    from app.services.spotify import get_auth_url

    return redirect(get_auth_url())


@admin_bp.route("/spotify/callback")
@login_required
def spotify_callback():
    """Handle the OAuth callback: exchange code for tokens and persist them."""
    error = request.args.get("error")
    if error:
        flash(f"Spotify authorization denied: {error}", "error")
        return redirect(url_for("admin.editions"))

    code = request.args.get("code")
    if not code:
        flash("Spotify callback received no authorization code.", "error")
        return redirect(url_for("admin.editions"))

    try:
        from app.services.spotify import exchange_code
        from app.models import ServiceToken

        token_data = exchange_code(code)
        ServiceToken.upsert(
            service="spotify",
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            expires_in=token_data.get("expires_in"),
            scope=token_data.get("scope"),
        )
        db.session.commit()
        flash("Spotify connected successfully.", "success")
    except Exception as exc:
        flash(f"Spotify token exchange failed: {exc}", "error")

    return redirect(url_for("admin.editions"))


@admin_bp.route("/spotify/disconnect", methods=["POST"])
@login_required
def spotify_disconnect():
    """Remove stored Spotify tokens."""
    from app.models import ServiceToken

    token = ServiceToken.get("spotify")
    if token:
        db.session.delete(token)
        db.session.commit()
        flash("Spotify disconnected.", "success")
    else:
        flash("Spotify was not connected.", "info")
    return redirect(url_for("admin.editions"))

