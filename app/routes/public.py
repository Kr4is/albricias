"""Public-facing routes — home, archive, edition and article pages."""

import datetime

from flask import Blueprint, render_template, request, session, redirect, url_for, flash

from app.auth import login_required
from app.extensions import db
from app.helpers import layout_index
from app.models import (
    Edition,
    Article,
    EDITION_STATUS_PUBLISHED,
)

public_bp = Blueprint("public", __name__)


# ---------------------------------------------------------------------------
# Auth helpers (login / logout live here because they render a public page)
# ---------------------------------------------------------------------------


@public_bp.route("/login", methods=["GET", "POST"])
def login():
    import os

    if request.method == "POST":
        password = request.form.get("password")
        if password == os.getenv("ADMIN_PASSWORD", "admin"):
            session["logged_in"] = True
            return redirect(request.args.get("next") or url_for("public.home"))
        flash("Invalid password", "error")
    return render_template("login.html")


@public_bp.route("/logout")
def logout():
    session.pop("logged_in", None)
    return redirect(url_for("public.home"))


# ---------------------------------------------------------------------------
# Home — latest published edition
# ---------------------------------------------------------------------------


@public_bp.route("/")
def home():
    latest = (
        Edition.query.filter_by(status=EDITION_STATUS_PUBLISHED)
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )
    if latest is None:
        return render_template("404.html"), 404

    prev_edition = (
        Edition.query.filter(
            Edition.status == EDITION_STATUS_PUBLISHED,
            db.or_(
                Edition.year < latest.year,
                db.and_(
                    Edition.year == latest.year, Edition.month < latest.month
                ),
            ),
        )
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )

    template = f"issue_v{layout_index(latest)}.html"
    return render_template(
        template,
        issue=latest,
        prev_issue=prev_edition,
        next_issue=None,
        Article=Article,
        is_current_issue=True,
        is_preview=False,
    )


# ---------------------------------------------------------------------------
# Archive
# ---------------------------------------------------------------------------


@public_bp.route("/archive")
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
            Article.query.join(Edition)
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
            for c in db.session.query(Article.category)
            .distinct()
            .order_by(Article.category)
            .all()
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

    query = (
        Edition.query.filter_by(status=EDITION_STATUS_PUBLISHED)
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


# ---------------------------------------------------------------------------
# Edition detail
# ---------------------------------------------------------------------------


@public_bp.route("/edition/<int:edition_id>")
def edition_detail(edition_id: int):
    edition = db.session.get(Edition, edition_id)
    if edition is None or not edition.is_published:
        return render_template("404.html"), 404

    prev_edition = (
        Edition.query.filter(
            Edition.status == EDITION_STATUS_PUBLISHED,
            db.or_(
                Edition.year < edition.year,
                db.and_(
                    Edition.year == edition.year, Edition.month < edition.month
                ),
            ),
        )
        .order_by(Edition.year.desc(), Edition.month.desc())
        .first()
    )
    next_edition = (
        Edition.query.filter(
            Edition.status == EDITION_STATUS_PUBLISHED,
            db.or_(
                Edition.year > edition.year,
                db.and_(
                    Edition.year == edition.year, Edition.month > edition.month
                ),
            ),
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
        is_preview=False,
    )


# ---------------------------------------------------------------------------
# Article detail
# ---------------------------------------------------------------------------


@public_bp.route("/article/<int:article_id>")
def article_detail(article_id: int):
    article = db.session.get(Article, article_id)
    if article is None or not article.edition.is_published:
        return render_template("404.html"), 404

    prev_article = (
        Article.query.filter(
            Article.edition_id == article.edition_id,
            Article.order < article.order,
        )
        .order_by(Article.order.desc())
        .first()
    )
    next_article = (
        Article.query.filter(
            Article.edition_id == article.edition_id,
            Article.order > article.order,
        )
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
# Legacy redirect
# ---------------------------------------------------------------------------


@public_bp.route("/issue/<path:issue_id>")
def issue_detail(issue_id: str):
    """Redirect old week-YYYY-MM-DD URLs to the archive."""
    return redirect(url_for("public.archive"), code=301)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------


@public_bp.app_errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404
