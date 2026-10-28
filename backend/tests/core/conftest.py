"""Discord fixtures shared by the build and sync tests: a server linked to the TD tournament's
primary track, with three events, and the in-memory Discord guild behind it."""

from contextlib import nullcontext

import pytest

from app.models.discord import DiscordGuildLink
from app.models.models import (
    TournamentBuilding,
    TournamentBuildingTrack,
    TournamentEvent,
    TournamentEventTrack,
)
from tests.conftest import primary_track_id

GUILD_ID = 5000


@pytest.fixture
def scope(db):
    return lambda: nullcontext(db)


@pytest.fixture
def track_id(db, td_tournament) -> int:
    return primary_track_id(db, td_tournament.id)


@pytest.fixture
def events(db, td_tournament, track_id) -> dict[str, TournamentEvent]:
    """Circuit Lab B and C in Rowland Hall, Anatomy C unplaced."""
    rowland = TournamentBuilding(tournament_id=td_tournament.id, name="Rowland Hall")
    db.add(rowland)
    db.flush()
    db.add(TournamentBuildingTrack(building_id=rowland.id, track_id=track_id))
    made = {}
    for name, division, building in [
        ("Circuit Lab", "B", rowland.id),
        ("Circuit Lab", "C", rowland.id),
        ("Anatomy", "C", None),
    ]:
        event = TournamentEvent(tournament_id=td_tournament.id, name=name, division=division)
        db.add(event)
        db.flush()
        db.add(
            TournamentEventTrack(
                tournament_event_id=event.id, track_id=track_id, building_id=building
            )
        )
        made[f"{name} {division}"] = event
    db.commit()
    return made


@pytest.fixture
def link(db, td_tournament, track_id, events) -> DiscordGuildLink:
    link = DiscordGuildLink(tournament_id=td_tournament.id, track_id=track_id, guild_id=GUILD_ID)
    db.add(link)
    db.commit()
    return link


@pytest.fixture
def guild(mock_discord_rest):
    return mock_discord_rest.add_guild(GUILD_ID)
