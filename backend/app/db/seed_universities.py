"""
Idempotent seed for the University lookup table.

Safe to run in ANY environment (dev or prod) — uses ON CONFLICT DO NOTHING
keyed on the unique `name` column, so it never duplicates or overwrites
existing rows. Intended to be called every startup from the lifespan,
same as seed_canon_events.

Run directly:
    python -m app.db.seed_universities
"""

from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

# name -> (abbreviation, location)
UNIVERSITIES = {
    "University of California, Irvine": ("UCI", "Irvine, CA"),
    "University of California, Los Angeles": ("UCLA", "Los Angeles, CA"),
    "University of Southern California": ("USC", "Los Angeles, CA"),
    "University of California, San Diego": ("UCSD", "La Jolla, CA"),
    "University of California, Santa Barbara": ("UCSB", "Santa Barbara, CA"),
    "Stanford University": ("Stanford", "Stanford, CA"),
    "University of California, Berkeley": ("UC Berkeley", "Berkeley, CA"),
    "University of California, Davis": ("UC Davis", "Davis, CA"),
    "California Institute of Technology": ("Caltech", "Pasadena, CA"),
    "University of California, Riverside": ("UCR", "Riverside, CA"),
    "University of California, Santa Cruz": ("UCSC", "Santa Cruz, CA"),
    "University of California, Merced": ("UCM", "Merced, CA"),
    "Harvey Mudd College": ("Harvey Mudd", "Claremont, CA"),
}


def seed_universities(db: Session) -> None:
    """
    Upsert universities by unique `name`. Safe to call on every startup in
    every environment — existing rows are left untouched.
    """
    from app.models.models import University

    values = [
        {"name": name, "abbreviation": abbreviation, "location": location}
        for name, (abbreviation, location) in UNIVERSITIES.items()
    ]
    stmt = insert(University).values(values)
    stmt = stmt.on_conflict_do_nothing(index_elements=["name"])
    db.execute(stmt)
    db.commit()

    print(f"Seeded/verified {len(UNIVERSITIES)} universities.")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        seed_universities(db)
