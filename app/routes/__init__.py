"""Blueprint registration helper."""

from .public import public_bp
from .admin import admin_bp
from .compose import compose_bp
from .api import api_bp


def register_blueprints(app) -> None:
    app.register_blueprint(public_bp)
    app.register_blueprint(admin_bp, url_prefix="/admin")
    app.register_blueprint(compose_bp)
    app.register_blueprint(api_bp, url_prefix="/api")
