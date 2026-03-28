"""GitHub API integration for Albricias.

Fetches monthly activity for a given user: commits, pull requests, issues,
releases, and starred repositories using the GitHub REST API v3.

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


def _month_range(year: int, month: int) -> tuple[str, str]:
    """Return ISO8601 start and end datetime strings for the given month."""
    _, last_day = calendar.monthrange(year, month)
    start = datetime.datetime(year, month, 1, 0, 0, 0, tzinfo=datetime.timezone.utc)
    end = datetime.datetime(year, month, last_day, 23, 59, 59, tzinfo=datetime.timezone.utc)
    return start.isoformat(), end.isoformat()


def _paginate(client: "httpx.Client", url: str, params: dict | None = None) -> list[dict]:
    """Follow GitHub pagination and return all items."""
    results: list[dict] = []
    next_url: str | None = url
    params = params or {}

    while next_url:
        resp = client.get(next_url, params=params)
        if resp.status_code == 422 or resp.status_code == 404:
            break
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            results.extend(data)
        elif isinstance(data, dict):
            # Search results wrap items
            results.extend(data.get("items", []))

        link_header = resp.headers.get("Link", "")
        next_url = None
        for part in link_header.split(","):
            part = part.strip()
            if 'rel="next"' in part:
                next_url = part.split(";")[0].strip().strip("<>")
                params = {}  # URL already contains params
                break

    return results


def _parse_timestamp(ts: str | None) -> datetime.datetime | None:
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def fetch_monthly_activity(
    username: str, year: int, month: int, token: str
) -> list[dict[str, Any]]:
    """Fetch all relevant GitHub activity for *username* during *year*-*month*.

    Returns a list of normalised activity dicts with keys:
        event_type, repo, title, url, timestamp, raw
    """
    start_iso, end_iso = _month_range(year, month)
    activities: list[dict] = []

    with httpx.Client(
        base_url=GITHUB_API,
        headers=_headers(token),
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        # ------------------------------------------------------------------ #
        # 1. Commits (search API)
        # ------------------------------------------------------------------ #
        try:
            q = f"author:{username} author-date:{start_iso[:10]}..{end_iso[:10]}"
            commits = _paginate(
                client,
                f"{GITHUB_API}/search/commits",
                {"q": q, "per_page": 100},
            )
            for c in commits:
                repo = c.get("repository", {}).get("full_name", "unknown")
                activities.append(
                    {
                        "event_type": "commit",
                        "repo": repo,
                        "title": c.get("commit", {}).get("message", "").split("\n")[0][:200],
                        "url": c.get("html_url"),
                        "timestamp": _parse_timestamp(
                            c.get("commit", {}).get("author", {}).get("date")
                        ),
                        "raw": c,
                    }
                )
        except Exception as exc:
            print(f"[github] Commits fetch failed: {exc}")

        # ------------------------------------------------------------------ #
        # 2. Pull Requests (search API)
        # ------------------------------------------------------------------ #
        try:
            q = f"author:{username} type:pr created:{start_iso[:10]}..{end_iso[:10]}"
            prs = _paginate(
                client,
                f"{GITHUB_API}/search/issues",
                {"q": q, "per_page": 100},
            )
            for pr in prs:
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

        # ------------------------------------------------------------------ #
        # 3. Issues created (search API)
        # ------------------------------------------------------------------ #
        try:
            q = f"author:{username} type:issue created:{start_iso[:10]}..{end_iso[:10]}"
            issues = _paginate(
                client,
                f"{GITHUB_API}/search/issues",
                {"q": q, "per_page": 100},
            )
            for iss in issues:
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

        # ------------------------------------------------------------------ #
        # 4. Releases published by the user across their repos
        # ------------------------------------------------------------------ #
        try:
            user_repos = _paginate(
                client,
                f"{GITHUB_API}/users/{username}/repos",
                {"per_page": 100, "sort": "pushed"},
            )
            for repo_obj in user_repos:
                repo_name = repo_obj.get("full_name", "")
                releases = _paginate(
                    client,
                    f"{GITHUB_API}/repos/{repo_name}/releases",
                    {"per_page": 20},
                )
                for rel in releases:
                    published_at = _parse_timestamp(rel.get("published_at"))
                    if published_at and published_at.year == year and published_at.month == month:
                        activities.append(
                            {
                                "event_type": "release",
                                "repo": repo_name,
                                "title": rel.get("name") or rel.get("tag_name", "")[:200],
                                "url": rel.get("html_url"),
                                "timestamp": published_at,
                                "raw": rel,
                            }
                        )
        except Exception as exc:
            print(f"[github] Releases fetch failed: {exc}")

    return activities


def _repo_from_url(repository_url: str) -> str:
    """Convert https://api.github.com/repos/owner/name → owner/name."""
    prefix = f"{GITHUB_API}/repos/"
    if repository_url.startswith(prefix):
        return repository_url[len(prefix):]
    return repository_url
