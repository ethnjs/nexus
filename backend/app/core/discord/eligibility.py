"""Who passes a server's gate: a linked NEXUS user who owns the tournament, or holds any
assignment on the server's track or any tournament-wide one, while the tournament isn't archived
and the track isn't being deleted. Site admins get no special treatment."""

from sqlalchemy.orm import Session

from app.models.discord import DiscordGuildLink
from app.models.models import TournamentMembership, TournamentTrackAssignment, User


def is_eligible(db: Session, link: DiscordGuildLink, user: User) -> bool:
    if link.tournament.is_archived or link.track.is_archived:
        return False
    if link.tournament.owner_id == user.id:
        return True
    return (
        db.query(TournamentTrackAssignment.id)
        .join(
            TournamentMembership, TournamentMembership.id == TournamentTrackAssignment.membership_id
        )
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == link.tournament_id,
            (TournamentTrackAssignment.tournament_track_id == link.track_id)
            | TournamentTrackAssignment.is_tournament_wide.is_(True),
        )
        .first()
        is not None
    )
