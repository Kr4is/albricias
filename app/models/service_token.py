"""ServiceToken model — stores OAuth tokens for external service integrations."""

import datetime
from app.extensions import db


class ServiceToken(db.Model):
    """Persisted OAuth token for an external service.

    One row per service (e.g. ``service="spotify"``). Updated in-place on
    every token refresh so the app always has a valid access token available.
    """

    __tablename__ = "service_tokens"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    service = db.Column(db.String(50), nullable=False, unique=True)
    access_token = db.Column(db.Text, nullable=False)
    refresh_token = db.Column(db.Text, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True)
    scope = db.Column(db.String(500), nullable=True)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    def __repr__(self) -> str:
        return f"<ServiceToken service={self.service}>"

    @property
    def is_expired(self) -> bool:
        """Return True if the access token has expired (with 60-second buffer)."""
        if self.expires_at is None:
            return False
        return datetime.datetime.utcnow() >= self.expires_at - datetime.timedelta(
            seconds=60
        )

    @classmethod
    def get(cls, service: str) -> "ServiceToken | None":
        """Convenience lookup by service name."""
        return cls.query.filter_by(service=service).first()

    @classmethod
    def upsert(
        cls,
        service: str,
        access_token: str,
        refresh_token: str | None = None,
        expires_in: int | None = None,
        scope: str | None = None,
    ) -> "ServiceToken":
        """Create or update the token record for *service*."""
        token = cls.get(service)
        expires_at = None
        if expires_in is not None:
            expires_at = datetime.datetime.utcnow() + datetime.timedelta(
                seconds=expires_in
            )
        if token is None:
            token = cls(
                service=service,
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=expires_at,
                scope=scope,
            )
            db.session.add(token)
        else:
            token.access_token = access_token
            if refresh_token:
                token.refresh_token = refresh_token
            token.expires_at = expires_at
            if scope:
                token.scope = scope
            token.updated_at = datetime.datetime.utcnow()
        return token
