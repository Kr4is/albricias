"""Compose route — manual article entry form."""

import datetime
import calendar

from flask import (
    Blueprint,
    render_template,
    request,
    redirect,
    url_for,
    flash,
)

from app.auth import login_required
from app.extensions import db
from app.helpers import save_media_file
from app.models import Edition, Article, EDITION_STATUS_DRAFT

compose_bp = Blueprint("compose", __name__)


@compose_bp.route("/compose", methods=["GET", "POST"])
@login_required
def compose_article():
    editions = Edition.query.order_by(
        Edition.year.desc(), Edition.month.desc()
    ).all()

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        content = request.form.get("content", "").strip()

        if not title or not content:
            flash("Headline and Narrative are required!", "error")
            return redirect(url_for("compose.compose_article"))

        category = request.form.get("category", "General")
        author = request.form.get("author", "Staff Writer").strip()
        date_str = request.form.get("date", "")
        edition_id_raw = request.form.get("edition_id", "")
        video_url = request.form.get("video_url", "").strip()

        # Resolve or create the target edition
        target_edition = None
        if edition_id_raw:
            target_edition = db.session.get(Edition, int(edition_id_raw))

        if target_edition is None:
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

        prefix = f"{target_edition.year}-{target_edition.month:02d}"
        max_order = (
            db.session.query(db.func.max(Article.order))
            .filter_by(edition_id=target_edition.id)
            .scalar()
        )

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
            order=(max_order or 0) + 1,
            date=article_date_obj,
            image=save_media_file(request.files.get("image"), "image", prefix),
            audio=save_media_file(request.files.get("audio"), "audio", prefix),
            video=video_url or None,
            source_type="manual",
        )
        db.session.add(article)
        db.session.commit()

        flash("Article saved to press successfully!", "success")
        return redirect(
            url_for("admin.edition_edit", edition_id=target_edition.id)
        )

    return render_template(
        "compose.html", now=datetime.datetime.now(), editions=editions
    )
