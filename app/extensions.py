"""Flask extensions — instantiated here, initialised in create_app()."""

import os
import datetime
import markdown as md_lib
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def register_template_filters(app) -> None:
    """Attach Jinja2 filters and context processors to *app*."""

    @app.template_filter("markdown")
    def markdown_filter(text: str) -> str:
        return md_lib.markdown(text or "", extensions=["fenced_code", "tables"])

    @app.context_processor
    def inject_newspaper_config() -> dict:
        return dict(
            newspaper={
                "name": os.getenv("NEWSPAPER_NAME", "¡Albricias!"),
                "tagline": os.getenv(
                    "NEWSPAPER_TAGLINE", "All the News That's Fit to Print"
                ),
                "price": os.getenv("NEWSPAPER_PRICE", "Two Cents"),
                "metadata_right": os.getenv("NEWSPAPER_METADATA_RIGHT", ""),
            },
            now=datetime.datetime.now(),
        )
