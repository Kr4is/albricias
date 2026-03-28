"""GitHub API integration for Albricias.

Fetches monthly activity for a given user: commits, pull requests, issues,
releases, starred repos, PR reviews, repos created, and gists.

Usage:
    activities = fetch_monthly_activity("octocat", 2026, 3, "ghp_token...")
"""

import calendar
import datetime
from typing import Any

try:
    import httpx
except ImportError:
    raise ImportError("httpx is required: uv add httpx")


GITHUB_API = "https://api.github.com"


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _star_headers(token: str) -> dict:
    """Accept header that includes starred_at timestamps."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3.star+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _month_range(year: int, month: int) -> tuple[str, str]:
    """Return ISO8601 start and end datetime strings for the given month."""
    _, last_day = calendar.monthrange(year, month)
    start = datetime.datetime(year, month, 1, 0, 0, 0, tzinfo=datetime.timezone.utc)
    end = datetime.datetime(
        year, month, last_day, 23, 59, 59, tzinfo=datetime.timezone.utc
    )
    return start.isoformat(), end.isoformat()


def _paginate(
    client: "httpx.Client", url: str, params: dict | None = None
) -> list[dict]:
    """Follow GitHub pagination and return all items."""
    results: list[dict] = []
    next_url: str | None = url
    params = params or {}

    while next_url:
        resp = client.get(next_url, params=params)
        if resp.status_code in (404, 422):
            break
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            results.extend(data)
        elif isinstance(data, dict):
            results.extend(data.get("items", []))

        link_header = resp.headers.get("Link", "")
        next_url = None
        for part in link_header.split(","):
            part = part.strip()
            if 'rel="next"' in part:
                next_url = part.split(";")[0].strip().strip("<>")
                params = {}
                break

    return results


def _paginate_with_headers(
    client: "httpx.Client", url: str, extra_headers: dict, params: dict | None = None
) -> list[dict]:
    """Like _paginate but with custom per-request headers (e.g. for starred API)."""
    results: list[dict] = []
    next_url: str | None = url
    params = params or {}

    while next_url:
        resp = client.get(next_url, params=params, headers=extra_headers)
        if resp.status_code in (404, 422):
            break
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            results.extend(data)

        link_header = resp.headers.get("Link", "")
        next_url = None
        for part in link_header.split(","):
            part = part.strip()
            if 'rel="next"' in part:
                next_url = part.split(";")[0].strip().strip("<>")
                params = {}
                break

    return results


def _parse_timestamp(ts: str | None) -> datetime.datetime | None:
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _in_month(dt: datetime.datetime | None, year: int, month: int) -> bool:
    return dt is not None and dt.year == year and dt.month == month


def _repo_from_url(repository_url: str) -> str:
    """Convert https://api.github.com/repos/owner/name → owner/name."""
    prefix = f"{GITHUB_API}/repos/"
    if repository_url.startswith(prefix):
        return repository_url[len(prefix):]
    return repository_url


def fetch_monthly_activity(
    username: str, year: int, month: int, token: str
) -> list[dict[str, Any]]:
    """Fetch all relevant GitHub activity for *username* during *year*-*month*.

    Returns a list of normalised activity dicts with keys:
        event_type, repo, title, url, timestamp, raw

    Event types returned:
        commit, pr, issue, release, star, review, repo_created, gist
    """
    start_iso, end_iso = _month_range(year, month)
    start_date = start_iso[:10]
    end_date = end_iso[:10]
    activities: list[dict] = []

    with httpx.Client(
        base_url=GITHUB_API,
        headers=_headers(token),
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        # ------------------------------------------------------------------
        # Commits (search API)
        # ------------------------------------------------------------------
        try:
            q = f"author:{username} author-date:{start_date}..{end_date}"
            for c in _paginate(
                client, f"{GITHUB_API}/search/commits", {"q": q, "per_page": 100}
            ):
                repo = c.get("repository", {}).get("full_name", "unknown")
                activities.append(
                    {
                        "event_type": "commit",
                        "repo": repo,
                        "title": c.get("commit", {})
                        .get("message", "")
                        .split("\n")[0][:200],
                        "url": c.get("html_url"),
                        "timestamp": _parse_timestamp(
                            c.get("commit", {}).get("author", {}).get("date")
                        ),
                        "raw": c,
                    }
                )
        except Exception as exc:
            print(f"[github] Commits fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Pull Requests opened (search API)
        # ------------------------------------------------------------------
        try:
            q = f"author:{username} type:pr created:{start_date}..{end_date}"
            for pr in _paginate(
                client, f"{GITHUB_API}/search/issues", {"q": q, "per_page": 100}
            ):
                activities.append(
                    {
                        "event_type": "pr",
                        "repo": _repo_from_url(pr.get("repository_url", "")),
                        "title": pr.get("title", "")[:200],
                        "url": pr.get("html_url"),
                        "timestamp": _parse_timestamp(pr.get("created_at")),
                        "raw": pr,
                    }
                )
        except Exception as exc:
            print(f"[github] PRs fetch failed: {exc}")

        # ------------------------------------------------------------------
        # PR reviews submitted (search API)
        # ------------------------------------------------------------------
        try:
            q = f"reviewed-by:{username} type:pr updated:{start_date}..{end_date}"
            for pr in _paginate(
                client, f"{GITHUB_API}/search/issues", {"q": q, "per_page": 100}
            ):
                activities.append(
                    {
                        "event_type": "review",
                        "repo": _repo_from_url(pr.get("repository_url", "")),
                        "title": pr.get("title", "")[:200],
                        "url": pr.get("html_url"),
                        "timestamp": _parse_timestamp(pr.get("updated_at")),
                        "raw": pr,
                    }
                )
        except Exception as exc:
            print(f"[github] PR reviews fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Issues created (search API)
        # ------------------------------------------------------------------
        try:
            q = f"author:{username} type:issue created:{start_date}..{end_date}"
            for iss in _paginate(
                client, f"{GITHUB_API}/search/issues", {"q": q, "per_page": 100}
            ):
                activities.append(
                    {
                        "event_type": "issue",
                        "repo": _repo_from_url(iss.get("repository_url", "")),
                        "title": iss.get("title", "")[:200],
                        "url": iss.get("html_url"),
                        "timestamp": _parse_timestamp(iss.get("created_at")),
                        "raw": iss,
                    }
                )
        except Exception as exc:
            print(f"[github] Issues fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Releases published across user repos
        # ------------------------------------------------------------------
        try:
            user_repos = _paginate(
                client,
                f"{GITHUB_API}/users/{username}/repos",
                {"per_page": 100, "sort": "pushed"},
            )
            for repo_obj in user_repos:
                repo_name = repo_obj.get("full_name", "")
                for rel in _paginate(
                    client,
                    f"{GITHUB_API}/repos/{repo_name}/releases",
                    {"per_page": 20},
                ):
                    published_at = _parse_timestamp(rel.get("published_at"))
                    if _in_month(published_at, year, month):
                        activities.append(
                            {
                                "event_type": "release",
                                "repo": repo_name,
                                "title": (
                                    rel.get("name") or rel.get("tag_name", "")
                                )[:200],
                                "url": rel.get("html_url"),
                                "timestamp": published_at,
                                "raw": rel,
                            }
                        )
        except Exception as exc:
            print(f"[github] Releases fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Repositories created this month (authenticated user repos)
        # ------------------------------------------------------------------
        try:
            for repo_obj in _paginate(
                client,
                f"{GITHUB_API}/user/repos",
                {"per_page": 100, "sort": "created", "direction": "desc"},
            ):
                created_at = _parse_timestamp(repo_obj.get("created_at"))
                if not _in_month(created_at, year, month):
                    # repos are sorted desc; once we pass the month, stop
                    if created_at and (
                        created_at.year < year
                        or (created_at.year == year and created_at.month < month)
                    ):
                        break
                    continue
                repo_name = repo_obj.get("full_name", "")
                description = (repo_obj.get("description") or "New repository")[:200]
                activities.append(
                    {
                        "event_type": "repo_created",
                        "repo": repo_name,
                        "title": f"{repo_name}: {description}",
                        "url": repo_obj.get("html_url"),
                        "timestamp": created_at,
                        "raw": repo_obj,
                    }
                )
        except Exception as exc:
            print(f"[github] Repos-created fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Starred repositories (starred_at within the month)
        # ------------------------------------------------------------------
        try:
            star_items = _paginate_with_headers(
                client,
                f"{GITHUB_API}/users/{username}/starred",
                extra_headers=_star_headers(token),
                params={"per_page": 100},
            )
            for item in star_items:
                starred_at = _parse_timestamp(item.get("starred_at"))
                if not starred_at:
                    continue
                # Stars are returned newest-first; stop once we go past our month
                if starred_at.year < year or (
                    starred_at.year == year and starred_at.month < month
                ):
                    break
                if not _in_month(starred_at, year, month):
                    continue
                repo_obj = item.get("repo", {})
                repo_name = repo_obj.get("full_name", "")
                description = (repo_obj.get("description") or "")[:150]
                title = repo_name
                if description:
                    title = f"{repo_name} — {description}"
                activities.append(
                    {
                        "event_type": "star",
                        "repo": repo_name,
                        "title": title[:200],
                        "url": repo_obj.get("html_url"),
                        "timestamp": starred_at,
                        "raw": repo_obj,
                    }
                )
        except Exception as exc:
            print(f"[github] Starred repos fetch failed: {exc}")

        # ------------------------------------------------------------------
        # Gists created this month
        # ------------------------------------------------------------------
        try:
            for gist in _paginate(
                client,
                f"{GITHUB_API}/users/{username}/gists",
                {"per_page": 100},
            ):
                created_at = _parse_timestamp(gist.get("created_at"))
                if not created_at:
                    continue
                if created_at.year < year or (
                    created_at.year == year and created_at.month < month
                ):
                    break
                if not _in_month(created_at, year, month):
                    continue
                description = (gist.get("description") or "Untitled gist")[:200]
                activities.append(
                    {
                        "event_type": "gist",
                        "repo": None,
                        "title": description,
                        "url": gist.get("html_url"),
                        "timestamp": created_at,
                        "raw": gist,
                    }
                )
        except Exception as exc:
            print(f"[github] Gists fetch failed: {exc}")

    return activities
