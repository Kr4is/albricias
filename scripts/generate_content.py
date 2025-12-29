import os
import random
from datetime import datetime, timedelta

# Configuration
BASE_DIR = "/home/bruno/Documents/dev/albricias/content/articles"
START_DATE = datetime(2023, 10, 30) # A Monday
WEEKS = 5
ARTICLES_PER_WEEK = 5

TITLES = [
    "New Library Functionality", "Urban Planning Shift", "Local Jazz Scene Explodes",
    "Tech Giants Merge", "Sustainable Farming Wins", "Coffee Prices stabilize",
    "Metro Line Extension", "Rare Bird Sighted", "Coding Bootcamp Success",
    "Old Factory Renovated", "Bridge Construction Halted", "New Park Opens",
    "Digital Privacy Law", "Quantum Leap in AI", "Space Telescope Data",
    "Local Election Results", "Weather Pattern Shift", "Historic Building Saved",
    "Start-up Boom in City", "Traffic Congestion Ease", "Museum Exhibit Opens",
    "River Cleanup Project", "School District Reform", "Hospital Wing Added"
]

CATEGORIES = ["News", "Metro", "Arts", "Tech", "Repo", "Paper", "Opinion"]
AUTHORS = ["J. Doe", "A. Smith", "M. Ray", "GPT-4", "Claude", "Bard"]

LOREM = """
Minimally designed, yet maximally effective, this new initiative seeks to redefine how we perceive public spaces. 
For decades, the standard approach has been one of utility over aesthetics, but a new wave of architects is challenging that notion.
The project, slated for completion next year, involves a complete overhaul of the downtown district.
"We want to bring life back to the streets," says lead designer Elena Kogan. "It's about human connection."

Critics, however, argue that the budget could be better spent on infrastructure. 
The mayor has promised transparency throughout the process, establishing a committee to oversee expenses.
Local business owners are cautiously optimistic, hoping the increased foot traffic will boost revenue.

In a related development, zoning laws are being reviewed to allow for more mixed-use buildings.
This could transform the skyline, adding a modern touch to the historic quarter.
Residents have expressed mixed feelings, with some fearing gentrification while others welcome the modernization.
Whatever the outcome, change is certainly on the horizon.
"""

def slugify(title):
    return title.lower().replace(" ", "-")

def create_articles():
    print(f"Generating articles in {BASE_DIR}...")
    
    current_date = START_DATE
    
    for week in range(WEEKS):
        print(f"Week {week+1}: {current_date.strftime('%Y-%m-%d')}")
        
        # Shuffle titles to get random ones
        week_titles = random.sample(TITLES, ARTICLES_PER_WEEK)
        
        for i, title in enumerate(week_titles):
            # Vary date slightly within the week (Monday to Sunday)
            day_offset = random.randint(0, 6)
            article_date = current_date + timedelta(days=day_offset)
            
            filename = f"{article_date.strftime('%Y-%m-%d')}-{slugify(title)}.md"
            filepath = os.path.join(BASE_DIR, filename)
            
            content = f"""---
title: {title}
date: {article_date.strftime('%Y-%m-%d')}
category: {random.choice(CATEGORIES)}
author: {random.choice(AUTHORS)}
---

{LOREM}

{LOREM if random.random() > 0.5 else ""}
"""
            with open(filepath, "w") as f:
                f.write(content)
            
            print(f"  Created: {filename}")
            
        current_date += timedelta(weeks=1)

if __name__ == "__main__":
    create_articles()
