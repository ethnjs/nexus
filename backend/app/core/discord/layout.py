"""What a server's managed roles and channels should be, as pure functions of NEXUS data."""

from app.models.models import TournamentEvent


def event_name_with_division(event: TournamentEvent) -> str:
    """ "Circuit Lab C". Same convention as the frontend's eventNameWithDivision."""
    name = event.display_name or "Unnamed event"
    return f"{name} {event.division}" if event.division else name
