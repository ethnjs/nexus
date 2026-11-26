import pytest
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session

from app.core.tournament.event_fields import loader_options
from app.models.models import TournamentEvent


def test_unrequested_relationships_raise_instead_of_loading(db: Session, td_tournament):
    """An unrequested group must cost no query, and code that reads it anyway
    must fail rather than see an empty collection."""
    db.add(TournamentEvent(tournament_id=td_tournament.id, name="Boomilever", division="C"))
    db.flush()
    db.expire_all()

    (event,) = db.query(TournamentEvent).options(*loader_options(frozenset({"shifts"}))).all()
    with pytest.raises(InvalidRequestError):
        _ = event.tracks
    assert event.shifts == []
