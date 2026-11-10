"""
One-time script: populate season_events for the 2027 season (Division B + C).

Ensures canon events/categories are seeded (adds "Botany"), then upserts
season_events rows for 2027 marked is_active=True, with each event's format,
impound and self-schedule from EVENT_DETAILS. Safe to re-run: it overwrites
those fields and is_active on rows that already exist.

Run directly:
    python -m app.db.seed_season_events_2027
"""

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

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
    "Thermodynamics",
    "Boomilever",
    "Electric Vehicle",
    "Mission Possible",
    "Wright Stuff",
    "Codebusters",
    "Engineering CAD",
    "Experimental Design",
    "Ping-Pong Parachute",
]


# (format, has_impound, has_self_schedule), shared by an event's B and C rows.
EVENT_DETAILS: dict[str, tuple[str, bool, bool]] = {
    "Anatomy and Physiology": ("test", False, False),
    "Astronomy": ("test", False, False),
    "Boomilever": ("build", True, True),
    "Botany": ("test", False, False),
    "Chemistry Lab": ("hybrid", False, False),
    "Circuit Lab": ("hybrid", False, False),
    "Codebusters": ("test", False, False),
    "Crime Busters": ("hybrid", False, False),
    "Designer Genes": ("test", False, False),
    "Disease Detectives": ("test", False, False),
    "Dynamic Planet": ("test", False, False),
    "Elastic Launched Glider": ("build", False, True),
    "Electric Vehicle": ("build", True, True),
    "Engineering CAD": ("test", False, False),
    "Experimental Design": ("test", False, False),
    "Food Science": ("hybrid", False, False),
    "Forensics": ("hybrid", False, False),
    "Heredity": ("test", False, False),
    "Hovercraft": ("build", True, True),
    "Meteorology": ("test", False, False),
    "Mission Possible": ("build", True, True),
    "Ping-Pong Parachute": ("build", True, True),
    "Protein Modeling": ("hybrid", True, False),
    "Remote Sensing": ("test", False, False),
    "Rocks and Minerals": ("test", False, False),
    "Roller Coaster": ("build", True, True),
    "Scrambler": ("build", True, True),
    "Solar System": ("test", False, False),
    "Thermodynamics": ("hybrid", True, False),
    "Water Quality": ("hybrid", False, False),
    "Wright Stuff": ("build", False, True),
    "Write It Do It": ("test", False, False),
}


def seed_season_events_2027(db: Session) -> None:
    from app.models.models import Event, SeasonEvent

    seed_events_and_categories(db)

    event_id_by_name = {name: eid for eid, name in db.query(Event.id, Event.name).all()}

    rows = []
    for division, names in (("B", DIVISION_B_EVENTS), ("C", DIVISION_C_EVENTS)):
        for name in names:
            event_id = event_id_by_name.get(name)
            if event_id is None:
                raise ValueError(f"Event {name!r} not found in canon events table")
            format_, has_impound, has_self_schedule = EVENT_DETAILS[name]
            rows.append(
                {
                    "event_id": event_id,
                    "year": YEAR,
                    "division": division,
                    "is_active": True,
                    "format": format_,
                    "has_impound": has_impound,
                    "has_self_schedule": has_self_schedule,
                }
            )

    stmt = insert(SeasonEvent).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["event_id", "year", "division"],
        set_={
            field: stmt.excluded[field]
            for field in ("is_active", "format", "has_impound", "has_self_schedule")
        },
    )
    db.execute(stmt)
    db.commit()

    print(
        f"Seeded {len(rows)} season_events rows for {YEAR} (Division B: {len(DIVISION_B_EVENTS)}, Division C: {len(DIVISION_C_EVENTS)})."
    )


if __name__ == "__main__":
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        seed_season_events_2027(db)
