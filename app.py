"""Albricias - A vintage newspaper-style web application."""

from flask import Flask, render_template, request
from models import db, Issue, Article

app = Flask(__name__)

# Database configuration
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///albricias.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)


# Seed data
SEED_ISSUES = [
    {
        "id": "week-oct-23-2023",
        "date": "Week of October 23, 2023",
        "date_short": "Oct 23",
        "vol": "CXLIII NO. 49",
        "year": 2023,
        "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuBp3_J4xTlbxtZw42osuYRDnHGOd68V4IJa_RWYpfIh4vfpy5Z722y_gXtCeyrHyz77I1cGAqKqr3puXjqr4tMfMBzfZsulCzp--KZj3bY_2b9E2AIW-I5HPj90Bv3iRbyRIb4QOwjPwHwMWi92l1tGn_836XzkN1_h2DBxM7H-OrHayMrdtzSgWsP6XV9MTSgrcjE2GTuYpM4fs970igX5Er1nRdKvs_1rO68D3UMuLm4Tu5rr2K-7XGo-2gV8gpbL2ST-8Fd7mmM",
        "articles": [
            {
                "title": "Global Markets Rally as Inflation Cools",
                "content": "Global markets rally as inflation cools significantly in the third quarter. A deep dive into the changing economic landscape and what it means for the upcoming fiscal year. The sudden uptick comes as a relief to investors who have been weathering a stormy quarter marked by geopolitical instability and fears of a looming recession.",
                "category": "Business",
                "author": "Financial Desk",
                "deck": "G",
                "order": 0,
            },
            {
                "title": "City Council Votes on Historic Zoning Reform Bill",
                "content": "In a move that could reshape the skyline for generations, the City Council last night approved a sweeping zoning reform package. The marathon session, lasting well into the early hours of the morning, saw fierce debate from both sides of the aisle.",
                "category": "Politics",
                "author": "Eleanor Rigby",
                "deck": "I",
                "order": 1,
            },
            {
                "title": "Transit Authority Announces Major Signal Delays",
                "content": "Commuters faced another morning of frustration as signal problems caused system-wide delays on the subway lines. The MTA cited 'aging infrastructure' and a lack of overnight maintenance crews as the primary causes.",
                "category": "Local",
                "author": "The Editorial Board",
                "deck": "C",
                "order": 2,
            },
        ],
    },
    {
        "id": "week-oct-16-2023",
        "date": "Week of October 16, 2023",
        "date_short": "Oct 16",
        "vol": "CXLIII NO. 48",
        "year": 2023,
        "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuDfp9cQ98MqHVYBu0P7yFLZXkyPkyZ6O3lP0btSLHsli-MSLMqAU4WZjBbTKwcdQJpQq5-_onXmHZXDknn8Qnv-ZsuLoMDmj-r2he4TV3akMi5ddalwvEtux9A-nAV4QqUzMh2vWDqUc3-nVBsDwXK74-qEOK784TpvnQXQ5ZcvLTE-lkQ2qdB87y6RYrV9BuVh1aPQZeurzNiElf0fV57TbtKB3ACsOfjfd9GoKJZB6ujNWHaOCUQcKugHFxLAqvUZ0XWok6zU2Z8",
        "articles": [
            {
                "title": "New Infrastructure Plans Unveiled",
                "content": "New city infrastructure plans unveiled amidst heated council debate. Local residents voice concerns over traffic congestion and environmental impact in the downtown district. The proposal includes a new light rail system and expanded bike lanes.",
                "category": "Politics",
                "author": "City Desk",
                "deck": "N",
                "order": 0,
            },
            {
                "title": "Tech Giants Face New Scrutiny",
                "content": "Tech giants face new scrutiny over data privacy practices. The Senate committee hearing reveals surprising internal memos regarding user tracking. Executives from major platforms testified before lawmakers.",
                "category": "Technology",
                "author": "Tech Correspondent",
                "deck": "T",
                "order": 1,
            },
            {
                "title": "Education Reform Bill Passes",
                "content": "Education reform bill passes first hurdle. Teachers' unions express cautious optimism as funding allocation details emerge. The bill promises significant increases in teacher salaries and classroom resources.",
                "category": "Education",
                "author": "Education Desk",
                "deck": "E",
                "order": 2,
            },
        ],
    },
    {
        "id": "week-oct-09-2023",
        "date": "Week of October 9, 2023",
        "date_short": "Oct 9",
        "vol": "CXLIII NO. 47",
        "year": 2023,
        "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuDOZb-BucUWnkyBXkzuJMGWuDexGbiopmZJNkS0BZyg1gn-4zGTwiP3XRenQZoIfJdg2qIlk6tnd4OTmWESoWp6Lj0HbeXO5SGe_l-POPeDrIMa88U1wiiBdt87pr3CvEMkVktx2pFFti5gv7kTvHd5yoBrOGKHioTT9NbleCR_t8hzsD60X-1FRXxs2vF6H7gdy2d86PwG2ZzsSOORgW6bjpBJ6RWYh_4xxeT1qJjkLjPRbNz760khkcL09DR7E4goiLTqJezDACw",
        "articles": [
            {
                "title": "The Sunday Review: Modern Architecture",
                "content": "A retrospective on modern architecture and its role in shaping community interactions. Plus, the weekly literary supplement featuring emerging voices in contemporary fiction.",
                "category": "Arts",
                "author": "Architecture Critic",
                "deck": "A",
                "order": 0,
            },
            {
                "title": "Weekend Arts & Leisure: Jazz Returns",
                "content": "The return of classic jazz to the riverfront, and an interview with the director of the upcoming historical drama 'The Silent Era'. Live performances scheduled throughout the weekend.",
                "category": "Arts",
                "author": "Arts Desk",
                "deck": "T",
                "order": 1,
            },
        ],
    },
    {
        "id": "week-dec-11-2022",
        "date": "Week of December 11, 2022",
        "date_short": "Dec 11",
        "vol": "CXLII NO. 350",
        "year": 2022,
        "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuDOp82N2UA5Yt2ETAkD-7pCS7T9M24ZqQQTdf4GzvrBRkuhQXw6pQBVGm2LpVrv4dZTuA-D-xiGmmZENWbGYJJQedrDaoU4sukeBXsl_V04uE0CAh3r90MpsPs14KPH-m6yWKcaOFCYOWMZZYb3jt-OegixRPk6ub3RfPZMpMPb4PP8QKoKVz6MfwY6KddN-uRi1T0wRoWJn9jq1lMAJ2p3NpC58VgaX0SXB4nlsd4waIFEEDez3jopekG8BUx2tlWAOgKdrzJ5Gro",
        "articles": [
            {
                "title": "Year in Review: 2022 Highlights",
                "content": "As the year draws to a close, we look back at the defining moments of 2022. From political upheavals to technological breakthroughs, it has been a year of transformation and challenge.",
                "category": "Editorial",
                "author": "Editorial Board",
                "deck": "Y",
                "order": 0,
            },
            {
                "title": "Autumn Harvest Festival Breaks Records",
                "content": "The annual Autumn Harvest Festival drew record crowds this weekend. Local farmers celebrated bountiful yields amid the festive atmosphere. Over 50,000 visitors attended.",
                "category": "Local",
                "author": "Local Desk",
                "deck": "A",
                "order": 1,
            },
        ],
    },
    {
        "id": "week-sep-05-2022",
        "date": "Week of September 5, 2022",
        "date_short": "Sep 5",
        "vol": "CXLII NO. 249",
        "year": 2022,
        "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuB2LjheQ60duhgORbAvmXif_lmk46GitSMQFyKK1ovXFracurNkrl7nTQl27OjYPxy9cFhhDzXfutuSQlyZwTzpRlApqZvSQfJqW3G_zaWvhD1GFf_Uom0N-diboE-kZ9-PMQG-pwhM7ehXvJ1Kzr8-LR1lWqsFAOcL32S7B0S3oWKObMkvsStGvJ3eoqkhMQpowTL2FUOieu5-iYE_9lglKC_tKXMRpIGpUAKVvSdQiUoM8QAibLU4V52EmyLw45XD7U1uYEKcL0E",
        "articles": [
            {
                "title": "Labor Day Special: Workers' Rights in Focus",
                "content": "On this Labor Day, we examine the evolving landscape of workers' rights. Unions report increased membership as cost of living pressures mount across the nation.",
                "category": "Politics",
                "author": "Labor Correspondent",
                "deck": "L",
                "order": 0,
            },
            {
                "title": "Summer Solstice Celebrations",
                "content": "The longest day of the year brings celebrations across the region. From dawn gatherings to evening festivals, communities mark the solstice with traditional ceremonies.",
                "category": "Local",
                "author": "Features Desk",
                "deck": "S",
                "order": 1,
            },
        ],
    },
]


def seed_database():
    """Seed the database with initial issues and articles if empty."""
    if Issue.query.first() is None:
        for issue_data in SEED_ISSUES:
            articles_data = issue_data.pop("articles")
            issue = Issue(**issue_data)
            db.session.add(issue)

            for article_data in articles_data:
                article = Article(issue_id=issue.id, **article_data)
                db.session.add(article)

        db.session.commit()
        print(f"Database seeded with {len(SEED_ISSUES)} issues and their articles.")


@app.route("/")
def home():
    """Render the current issue (home page)."""
    # Get the most recent issue
    latest_issue = Issue.query.order_by(Issue.year.desc(), Issue.date_short.desc()).first()
    return render_template("home.html", issue=latest_issue)


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
