# Albricias

A vintage newspaper-style web application built with Flask. This project simulates a digital newspaper archive, letting users browse current and past editions in a classic format.

## Features

- **Current Issue**: View the latest edition of Albricias.
- **Archives**: Browse a history of past issues with dates, volume numbers, and lead stories.
- **Vintage Design**: Styled to resemble a traditional printed newspaper.

## Prerequisites

- **Python**: version 3.11 or higher.

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd albricias
   ```

2. **Install dependencies:**
   This project uses `pyproject.toml` for configuration.
   
   ```bash
   uv sync
   ```

## Running the Application

1. **Start the server:**
   ```bash
   uv run app.py
   ```

2. **Open in browser:**
   Navigate to [http://127.0.0.1:5000](http://127.0.0.1:5000) to view the application.

## Project Structure

- **`app.py`**: Main application logic and route definitions.
- **`templates/`**: HTML files defining the structure of the pages.
- **`static/`**: CSS, JavaScript, and image assets.
