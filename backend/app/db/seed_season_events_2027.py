"""
One-time script: populate season_events for the 2027 season (Division B + C).

Renames the pre-existing "Anatomy & Physiology" canon event to "Anatomy and
Physiology" (matches the 2027 event list spelling), ensures canon events/
categories are seeded (adds "Botany"), then upserts season_events rows for
2027 marked is_active=True.

Run directly:
    python -m app.db.seed_season_events_2027
"""

from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.db.seed_canon_events import seed_events_and_categories

YEAR = 2027

DIVISION_B_EVENTS = [
    "Anatomy and Physiology",
    "Botany",
    "Disease Detectives",
    "Heredity",
    "Water Quality",
    "Dynamic Planet",
    "Meteorology",
    "Remote Sensing",
    "Rocks and Minerals",
    "Solar System",
    "Circuit Lab",
    "Crime Busters",
    "Food Science",
    "Hovercraft",
    "Thermodynamics",
    "Boomilever",
    "Elastic Launched Glider",
    "Roller Coaster",
    "Scrambler",
    "Codebusters",
    "Experimental Design",
    "Ping-Pong Parachute",
    "Write It Do It",
]

DIVISION_C_EVENTS = [
    "Anatomy and Physiology",
    "Botany",
    "Designer Genes",
    "Disease Detectives",
    "Water Quality",
    "Astronomy",
    "Dynamic Planet",
    "Remote Sensing",
    "Rocks and Minerals",
    "Chemistry Lab",
    "Circuit Lab",
    "Forensics",
    "Hovercraft",
    "Protein Modeling",
    "Boomilever",
    "Electric Vehicle",
    "Mission Possible",
    "Wright Stuff",
    "Codebusters",
    "Engineering CAD",
    "Experimental Design",
    "Ping-Pong Parachute",
]


def seed_season_events_2027(db: Session) -> None:
    from app.models.models import Event, SeasonEvent

    # Old canon spelling predates the 2027 list — rename in place so the
    # unique `name` constraint doesn't produce a duplicate event.
    old = db.query(Event).filter(Event.name == "Anatomy & Physiology").first()
    if old is not None:
        old.name = "Anatomy and Physiology"
        db.commit()

    seed_events_and_categories(db)

    event_id_by_name = {name: eid for eid, name in db.query(Event.id, Event.name).all()}

    rows = []
    for division, names in (("B", DIVISION_B_EVENTS), ("C", DIVISION_C_EVENTS)):
        for name in names:
            event_id = event_id_by_name.get(name)
            if event_id is None:
                raise ValueError(f"Event {name!r} not found in canon events table")
            rows.append({"event_id": event_id, "year": YEAR, "division": division, "is_active": True})

    stmt = insert(SeasonEvent).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["event_id", "year", "division"],
        set_={"is_active": stmt.excluded.is_active},
    )
    db.execute(stmt)
    db.commit()

    print(f"Seeded {len(rows)} season_events rows for {YEAR} (Division B: {len(DIVISION_B_EVENTS)}, Division C: {len(DIVISION_C_EVENTS)}).")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        seed_season_events_2027(db)
