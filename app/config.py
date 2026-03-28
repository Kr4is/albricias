"""Application configuration loaded from environment variables."""

import os


class Config:
    # Core Flask
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-key")
    DEBUG: bool = os.getenv("FLASK_DEBUG", "0") == "1"

    # Database
    SQLALCHEMY_DATABASE_URI: str = os.getenv(
        "SQLALCHEMY_DATABASE_URI", "sqlite:///albricias.db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS: bool = False

    # Uploads — resolved relative to the app package root at init time
    MAX_CONTENT_LENGTH: int = 50 * 1024 * 1024  # 50 MB

    # Authentication
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin")
    API_TOKEN: str | None = os.getenv("API_TOKEN")

    # Newspaper identity
    NEWSPAPER_NAME: str = os.getenv("NEWSPAPER_NAME", "¡Albricias!")
    NEWSPAPER_TAGLINE: str = os.getenv(
        "NEWSPAPER_TAGLINE", "All the News That's Fit to Print"
    )
    NEWSPAPER_PRICE: str = os.getenv("NEWSPAPER_PRICE", "Two Cents")
    NEWSPAPER_METADATA_RIGHT: str = os.getenv("NEWSPAPER_METADATA_RIGHT", "")

    # External integrations
    GITHUB_TOKEN: str | None = os.getenv("GITHUB_TOKEN")
    GITHUB_USERNAME: str | None = os.getenv("GITHUB_USERNAME")
    OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")
