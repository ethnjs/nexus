"""
Idempotent seed for event categories and events.

Safe to run in ANY environment (dev or prod) — uses ON CONFLICT DO NOTHING
keyed on the unique `name` column, so it never duplicates or overwrites
existing rows. Intended to be called every startup from the lifespan.

Run directly:
    python -m app.db.seed_events
"""

from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

CATEGORIES = [
    "Life, Personal & Social Science",
    "Earth & Space Science",
    "Physical Science & Chemistry",
    "Technology & Engineering",
    "Inquiry & Nature of Science",
]

# event name -> category name
EVENTS = {
    "A is for Anatomy": "Life, Personal & Social Science",
    "Aerodynamics": "Technology & Engineering",
    "Air Trajectory": "Technology & Engineering",
    "Amphibians & Reptiles": "Life, Personal & Social Science",
    "Anatomy": "Life, Personal & Social Science",
    "Anatomy and Physiology": "Life, Personal & Social Science",
    "Astronomy": "Earth & Space Science",
    "Awesome Aquifers": "Earth & Space Science",
    "Balancing Equations": "Physical Science & Chemistry",
    "Balloon Launch Glider": "Technology & Engineering",
    "Balloon Race": "Technology & Engineering",
    "Battery Buggy": "Technology & Engineering",
    "Bio-Process Lab": "Life, Personal & Social Science",
    "Boomilever": "Technology & Engineering",
    "Botany": "Life, Personal & Social Science",
    "Bottle Rocket": "Technology & Engineering",
    "Bridge": "Technology & Engineering",
    "Bridge Building": "Technology & Engineering",
    "Bungee Drop": "Technology & Engineering",
    "Bungee Egg Drop": "Technology & Engineering",
    "Calorimeter": "Physical Science & Chemistry",
    "Can't Judge a Powder": "Physical Science & Chemistry",
    "Cell Biology": "Life, Personal & Social Science",
    "Chemical ID": "Physical Science & Chemistry",
    "Chemistry Clue": "Physical Science & Chemistry",
    "Chemistry Lab": "Physical Science & Chemistry",
    "Circuit Lab": "Physical Science & Chemistry",
    "Codebusters": "Inquiry & Nature of Science",
    "Compound Machines": "Technology & Engineering",
    "Compute This": "Inquiry & Nature of Science",
    "Computer Programming": "Technology & Engineering",
    "Cow-A-Bungee": "Technology & Engineering",
    "Crave the Wave": "Physical Science & Chemistry",
    "Crime Busters": "Physical Science & Chemistry",
    "Density Lab": "Physical Science & Chemistry",
    "Designer Genes": "Life, Personal & Social Science",
    "Detector Building": "Technology & Engineering",
    "Disease Detectives": "Life, Personal & Social Science",
    "Don't Bug Me": "Life, Personal & Social Science",
    "Dynamic Planet": "Earth & Space Science",
    "Earth Science Lab": "Earth & Space Science",
    "Earth Science Processes": "Earth & Space Science",
    "Earth, Sea, and Sky": "Earth & Space Science",
    "Ecology": "Life, Personal & Social Science",
    "Egg Drop": "Technology & Engineering",
    "Egg-O-Naut": "Technology & Engineering",
    "Elastic Launched Glider": "Technology & Engineering",
    "Electric Vehicle": "Technology & Engineering",
    "Electric Wright Stuff": "Technology & Engineering",
    "Elevated Bridge": "Technology & Engineering",
    "Energy Contest": "Physical Science & Chemistry",
    "Engineering CAD": "Technology & Engineering",
    "Entomology": "Life, Personal & Social Science",
    "Environmental Chemistry": "Physical Science & Chemistry",
    "Experimental Design": "Inquiry & Nature of Science",
    "Facts in Five": "Inquiry & Nature of Science",
    "Fast Facts": "Inquiry & Nature of Science",
    "Feathered Frenzy": "Life, Personal & Social Science",
    "Fermi Questions": "Inquiry & Nature of Science",
    "Five Star Science": "Inquiry & Nature of Science",
    "Flight": "Technology & Engineering",
    "Food Science": "Physical Science & Chemistry",
    "Forensics": "Physical Science & Chemistry",
    "Forestry": "Life, Personal & Social Science",
    "Fossils": "Earth & Space Science",
    "From A Distance": "Earth & Space Science",
    "Game On": "Technology & Engineering",
    "Geologic Mapping": "Earth & Space Science",
    "Get Your Bearing": "Earth & Space Science",
    "Gravity Vehicle": "Technology & Engineering",
    "Green Generation": "Life, Personal & Social Science",
    "Health Science": "Life, Personal & Social Science",
    "Helicopter": "Technology & Engineering",
    "Heredity": "Life, Personal & Social Science",
    "Herpetology": "Life, Personal & Social Science",
    "Hot House": "Earth & Space Science",
    "Hovercraft": "Technology & Engineering",
    "Hydrogeology": "Earth & Space Science",
    "Invasive Species": "Life, Personal & Social Science",
    "It's About Time": "Technology & Engineering",
    "Junkyard Challenge": "Technology & Engineering",
    "Keep the Heat": "Physical Science & Chemistry",
    "Kite Flying": "Technology & Engineering",
    "Laser Shoot": "Physical Science & Chemistry",
    "Life Science Process Lab": "Life, Personal & Social Science",
    "Machines": "Technology & Engineering",
    "MagLev": "Technology & Engineering",
    "Map Reading": "Earth & Space Science",
    "Materials Science": "Physical Science & Chemistry",
    "Measurement": "Inquiry & Nature of Science",
    "Meteorology": "Earth & Space Science",
    "Metric Estimation": "Inquiry & Nature of Science",
    "Metric Mastery": "Inquiry & Nature of Science",
    "Microbe Mission": "Life, Personal & Social Science",
    "Mission Possible": "Technology & Engineering",
    "Mousetrap Vehicle": "Technology & Engineering",
    "Mystery Architecture": "Technology & Engineering",
    "Mystery Substance": "Physical Science & Chemistry",
    "Naked Egg Drop": "Technology & Engineering",
    "Name That Artifact": "Life, Personal & Social Science",
    "Name That Organism": "Life, Personal & Social Science",
    "Nature Quest": "Life, Personal & Social Science",
    "Oceanography": "Earth & Space Science",
    "Optics": "Physical Science & Chemistry",
    "Orienteering": "Earth & Space Science",
    "Ornithology": "Life, Personal & Social Science",
    "Out of This World": "Earth & Space Science",
    "Paper Airplane": "Technology & Engineering",
    "Password": "Inquiry & Nature of Science",
    "Pentathlon": "Inquiry & Nature of Science",
    "Periodic Table Quiz": "Physical Science & Chemistry",
    "Physical Science Lab": "Physical Science & Chemistry",
    "Physics Lab": "Physical Science & Chemistry",
    "Picture This": "Inquiry & Nature of Science",
    "Ping-Pong Parachute": "Technology & Engineering",
    "Polymer Detective": "Physical Science & Chemistry",
    "Potions and Poisons": "Physical Science & Chemistry",
    "Practical Data Gathering": "Inquiry & Nature of Science",
    "Practical Data Solving": "Inquiry & Nature of Science",
    "Process Skills": "Inquiry & Nature of Science",
    "Process Skills in Life Science": "Life, Personal & Social Science",
    "Propeller Propulsion": "Technology & Engineering",
    "Protein Modeling": "Life, Personal & Social Science",
    "Qualitative Analysis": "Physical Science & Chemistry",
    "Reach for the Stars": "Earth & Space Science",
    "Redesigned Genes": "Life, Personal & Social Science",
    "Remote Sensing": "Earth & Space Science",
    "Road Rally": "Technology & Engineering",
    "Road Scholar": "Earth & Space Science",
    "Robo-Billiards": "Technology & Engineering",
    "Robo-Cross": "Technology & Engineering",
    "Robot Arm": "Technology & Engineering",
    "Robot Ramble": "Technology & Engineering",
    "Robot Tour": "Technology & Engineering",
    "Rocks and Fossils": "Earth & Space Science",
    "Rocks and Minerals": "Earth & Space Science",
    "Rocks to Riches": "Earth & Space Science",
    "Rocks, Minerals, and Fossils": "Earth & Space Science",
    "Roller Coaster": "Physical Science & Chemistry",
    "Rotor Egg Drop": "Technology & Engineering",
    "Rube Goldberg Machine": "Technology & Engineering",
    "Science Bowl": "Inquiry & Nature of Science",
    "Science Clue": "Inquiry & Nature of Science",
    "Science Crime Busters": "Physical Science & Chemistry",
    "Science of Fitness": "Life, Personal & Social Science",
    "Science Search": "Inquiry & Nature of Science",
    "Science Word": "Inquiry & Nature of Science",
    "Scrambler": "Technology & Engineering",
    "Seven Up": "Inquiry & Nature of Science",
    "Shock Value": "Physical Science & Chemistry",
    "Simple Machines": "Technology & Engineering",
    "Solar Collector": "Technology & Engineering",
    "Solar Heating Contest": "Technology & Engineering",
    "Solar System": "Earth & Space Science",
    "Sounds of Music": "Physical Science & Chemistry",
    "Storm the Castle": "Technology & Engineering",
    "Sumo Bots": "Technology & Engineering",
    "Surfing the Net": "Inquiry & Nature of Science",
    "Technical Problem Solving": "Inquiry & Nature of Science",
    "Thermodynamics": "Physical Science & Chemistry",
    "Tic Toc": "Technology & Engineering",
    "Titration Race": "Physical Science & Chemistry",
    "Topographic Map Reading": "Earth & Space Science",
    "Tower": "Technology & Engineering",
    "Trajectory": "Technology & Engineering",
    "Trajectory Contest": "Technology & Engineering",
    "Tree Identification": "Life, Personal & Social Science",
    "Tree-mendous": "Life, Personal & Social Science",
    "Up, Up, & Away": "Technology & Engineering",
    "Using the Web": "Inquiry & Nature of Science",
    "Water Quality": "Earth & Space Science",
    "Water Strider": "Technology & Engineering",
    "Water, Water Everywhere": "Earth & Space Science",
    "Weather Or Not": "Earth & Space Science",
    "What Are You Trying To Tell Me": "Inquiry & Nature of Science",
    "Wheeled Vehicle": "Technology & Engineering",
    "WiFi Lab": "Technology & Engineering",
    "Wind Power": "Technology & Engineering",
    "Wright Stuff": "Technology & Engineering",
    "Write It Do It": "Inquiry & Nature of Science",
}


def seed_events_and_categories(db: Session) -> None:
    """
    Upsert categories + events by unique `name`. Safe to call on every
    startup in every environment — existing rows are left untouched.
    """
    from app.models.models import EventCategory, Event

    # 1. Categories
    stmt = insert(EventCategory).values([{"name": name} for name in CATEGORIES])
    stmt = stmt.on_conflict_do_nothing(index_elements=["name"])
    db.execute(stmt)
    db.commit()

    # 2. Look up category ids by name (works whether just-inserted or pre-existing)
    category_rows = db.query(EventCategory.id, EventCategory.name).all()
    category_id_by_name = {name: cid for cid, name in category_rows}

    # 3. Events
    event_values = [
        {"name": event_name, "category_id": category_id_by_name[category_name]}
        for event_name, category_name in EVENTS.items()
    ]
    stmt = insert(Event).values(event_values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["name"])
    db.execute(stmt)
    db.commit()

    print(f"Seeded/verified {len(CATEGORIES)} categories and {len(EVENTS)} events.")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        seed_events_and_categories(db)