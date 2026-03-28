"""Backwards-compatibility shim — GitHubActivity is now ServiceActivity."""

from .service_activity import ServiceActivity as GitHubActivity  # noqa: F401

__all__ = ["GitHubActivity"]
