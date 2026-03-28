"""WSGI entry point.

Used by:
  - Flask CLI:  FLASK_APP=wsgi.py flask run
  - Gunicorn:   gunicorn wsgi:application
"""

from dotenv import load_dotenv

load_dotenv()

from app import create_app  # noqa: E402 — dotenv must load before app config

application = create_app()

# Convenience alias so `flask run` works when FLASK_APP=wsgi.py
app = application
