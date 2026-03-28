# Final stage
FROM python:3.11-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Install dependencies using uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Ensure the app uses the virtualenv
ENV PATH="/app/.venv/bin:$PATH"


# Copy project files
COPY . .

# Create instance directory for the database if it doesn't exist
RUN mkdir -p instance

# Expose port
EXPOSE 8000

# Run gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--config", "gunicorn_config.py", "wsgi:application"]

