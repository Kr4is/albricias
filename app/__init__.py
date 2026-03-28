"""Albricias application factory."""

import os
from flask import Flask

from .config import Config
from .extensions import db, register_template_filters
from .routes import register_blueprints


def create_app(config_class=Config) -> Flask:
    """Create and configure the Flask application.

    Using the factory pattern keeps the app object out of module scope,
    which avoids circular imports and makes the app testable with different
    configurations.
    """
    app = Flask(__name__)

    # Load configuration
    app.config.from_object(config_class)

    # UPLOAD_FOLDER is derived from the app root at runtime
    app.config.setdefault(
        "UPLOAD_FOLDER",
        os.path.join(app.root_path, "static", "uploads"),
    )

    # Initialise extensions
    db.init_app(app)
    register_template_filters(app)

    # Register route blueprints
    register_blueprints(app)

    # Create database tables on first run
    with app.app_context():
        db.create_all()

    return app
