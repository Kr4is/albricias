"""Authentication decorators for view functions and API endpoints."""

import os
from functools import wraps
from flask import session, request, redirect, url_for


def login_required(f):
    """Redirect unauthenticated browser requests to the login page."""

    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("public.login", next=request.url))
        return f(*args, **kwargs)

    return decorated


def require_api_token(f):
    """Enforce Bearer token auth for API endpoints.

    If ``API_TOKEN`` is not configured the request is allowed through,
    so the API remains open in local / dev setups without extra config.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        token = os.getenv("API_TOKEN")
        if token:
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or auth.split(" ", 1)[1] != token:
                return {"error": "Unauthorized"}, 401
        return f(*args, **kwargs)

    return decorated
