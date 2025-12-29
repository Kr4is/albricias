# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY pyproject.toml .
# We use pip to install dependencies from pyproject.toml converted to requirements.txt logic or directly
# Since we are using 'uv' in dev, let's just install based on a generated requirements.txt or directly if simple.
# For simplicity here, we'll install dependencies directly. 
# In a real UV workflow, we'd use `uv export` to generate requirements.txt
RUN pip install --upgrade pip
RUN pip install flask flask-sqlalchemy python-dotenv gunicorn markdown

# Copy project
COPY . .

# Expose port
EXPOSE 8000

# Run gunicorn
CMD ["gunicorn", "--config", "gunicorn_config.py", "app:app"]
