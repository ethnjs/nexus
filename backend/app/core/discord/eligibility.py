"""Who passes a server's gate, and which managed roles each member should hold.

A Discord member is eligible when their account is linked to an active NEXUS user who owns the
tournament, or whose membership holds any assignment on the server's track or any
tournament-wide one, while the tournament isn't archived and the track isn't being deleted.
Site admins get no special treatment."""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.discord.layout import OWNER_KEY, VERIFIED_KEY, event_role_key, nickname, role_key
from app.models.discord import DiscordGuildLink
from app.models.models import (
    OAuthIdentity,
    OAuthProvider,
    TournamentMembership,
    TournamentTrackAssignment,
    User,
)


def is_eligible(db: Session, link: DiscordGuildLink, user: User) -> bool:
    return bool(_keys_by_user(db, link, {user.id}).get(user.id))


@dataclass
class DesiredMember:
    role_keys: set[str]
    nick: str | None


def desired_members(
    db: Session, link: DiscordGuildLink, discord_user_ids: Iterable[int]
) -> dict[int, DesiredMember]:
    """Discord user id -> the managed roles and nickname an eligible member should have. Four
    queries, however many members. Accounts left out are ineligible: they should hold no managed
    role, and their nickname is left alone."""
    ids = [str(i) for i in discord_user_ids]
    if not ids:
        return {}
    accounts = dict(
        db.query(OAuthIdentity.user_id, OAuthIdentity.provider_account_id).filter(
            OAuthIdentity.provider == OAuthProvider.discord,
            OAuthIdentity.provider_account_id.in_(ids),
        )
    )
    keys = {user_id: k for user_id, k in _keys_by_user(db, link, set(accounts)).items() if k}
    names = db.query(User.id, User.first_name, User.last_name).filter(User.id.in_(list(keys)))
    return {
        int(accounts[user_id]): DesiredMember(keys[user_id], nickname(first, last))
        for user_id, first, last in names
    }


def _keys_by_user(db: Session, link: DiscordGuildLink, user_ids: set[int]) -> dict[int, set[str]]:
    if not user_ids or link.tournament.is_archived or link.track.is_archived:
        return {}
    active = {
        user_id
        for (user_id,) in db.query(User.id).filter(User.id.in_(user_ids), User.status == "active")
    }
    rows = (
        db.query(
            TournamentMembership.user_id,
            TournamentTrackAssignment.role_id,
            TournamentTrackAssignment.is_tournament_wide,
            TournamentTrackAssignment.tournament_event_id,
        )
        .join(
            TournamentTrackAssignment,
            TournamentTrackAssignment.membership_id == TournamentMembership.id,
        )
        .filter(
            TournamentMembership.tournament_id == link.tournament_id,
            TournamentMembership.user_id.in_(active),
            (TournamentTrackAssignment.tournament_track_id == link.track_id)
            | TournamentTrackAssignment.is_tournament_wide.is_(True),
        )
        .all()
    )
    keys: dict[int, set[str]] = {}
    for user_id, role_id, is_wide, event_id in rows:
        held = keys.setdefault(user_id, {VERIFIED_KEY})
        held.add(role_key(role_id))
        # Zone and plain grant rows carry no event; only event rows give an event role.
        if event_id is not None and not is_wide:
            held.add(event_role_key(event_id))
    owner = link.tournament.owner_id
    if owner in active:
        keys.setdefault(owner, {VERIFIED_KEY}).add(OWNER_KEY)
    return keys
