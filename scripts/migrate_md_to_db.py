"""
One-time migration: convert content/articles/*.md files to the new
Edition/Article/GitHubActivity database schema.

Run from the project root:
    python scripts/migrate_md_to_db.py

After a successful run, content/articles/ is no longer needed.
"""

import sys
import os
import glob
import re
import datetime
import calendar

# Allow importing app modules from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import frontmatter
from dotenv import load_dotenv

load_dotenv()

from app import create_app
from app.extensions import db
from app.models import Edition, Article, EDITION_STATUS_PUBLISHED

app = create_app()


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text


def run_migration():
    articles_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "content", "articles")
    if not os.path.exists(articles_path):
        print(f"No content directory found at {articles_path}. Nothing to migrate.")
        return

    article_files = sorted(glob.glob(os.path.join(articles_path, "*.md")))
    if not article_files:
        print("No markdown files found. Nothing to migrate.")
        return

    print(f"Found {len(article_files)} markdown files to migrate.")

    with app.app_context():
        # Collect articles grouped by (year, month)
        editions_map: dict[tuple, list] = {}

        for article_file in article_files:
            filename = os.path.basename(article_file)
            match = re.match(r"(\d{4})-(\d{2})-(\d{2})-(.*)\.md", filename)
            if not match:
                print(f"  Skipping {filename}: does not match YYYY-MM-DD-slug.md pattern")
                continue

            year, month, day, slug = match.groups()
            year, month, day = int(year), int(month), int(day)
            key = (year, month)

            try:
                post = frontmatter.load(article_file)
            except Exception as e:
                print(f"  Skipping {filename}: could not parse frontmatter ({e})")
                continue

            article_date = datetime.date(year, month, day)
            editions_map.setdefault(key, []).append((article_date, post, filename))

        if not editions_map:
            print("No parseable articles found.")
            return

        migrated_editions = 0
        migrated_articles = 0

        for (year, month), articles in sorted(editions_map.items()):
            month_name = calendar.month_name[month]
            edition_title = f"{month_name} {year}"

            # Check if edition already exists
            existing = Edition.query.filter_by(year=year, month=month).first()
            if existing:
                print(f"  Edition '{edition_title}' already exists (id={existing.id}), skipping.")
                continue

            edition = Edition(
                month=month,
                year=year,
                title=edition_title,
                status=EDITION_STATUS_PUBLISHED,
                vol=f"VOL. {year} NO. {month}",
                cover_image=None,
                published_at=datetime.datetime.utcnow(),
            )
            db.session.add(edition)
            db.session.flush()  # get edition.id

            # Sort articles by date within the month
            articles_sorted = sorted(articles, key=lambda x: x[0])

            for order_idx, (article_date, post, filename) in enumerate(articles_sorted):
                title = post.get("title") or filename
                content = post.content or ""
                deck = post.get("deck") or (content[0] if content else "A")

                article = Article(
                    edition_id=edition.id,
                    title=title,
                    content=content,
                    category=post.get("category", "General"),
                    author=post.get("author", "Staff Writer"),
                    deck=deck[:1] if deck else "A",
                    order=post.get("order", order_idx),
                    date=article_date,
                    image=post.get("image"),
                    audio=post.get("audio"),
                    video=post.get("video"),
                    source_type="manual",
                )
                db.session.add(article)
                migrated_articles += 1
                print(f"    + Article: {title[:60]}")

            db.session.commit()
            print(f"  Edition '{edition_title}' created with {len(articles_sorted)} articles.")
            migrated_editions += 1

        print(f"\nMigration complete: {migrated_editions} editions, {migrated_articles} articles.")
        print(
            "You may now archive or remove content/articles/ — "
            "the database is now the source of truth."
        )


if __name__ == "__main__":
    run_migration()
