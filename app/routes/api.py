"""REST API endpoints."""

import datetime
import calendar

from flask import Blueprint, request, jsonify

from app.auth import require_api_token
from app.extensions import db
from app.models import Edition, Article, EDITION_STATUS_DRAFT

api_bp = Blueprint("api", __name__)


@api_bp.route("/articles", methods=["POST"])
@require_api_token
def create_article():
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

    edition = Edition.query.filter_by(
        year=article_date.year, month=article_date.month
    ).first()
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
    return (
        jsonify(
            {
                "message": "Article created",
                "article_id": article.id,
                "edition_id": edition.id,
            }
        ),
        201,
    )
