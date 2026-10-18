"""Marking servers and members dirty for the leader's drain. A mark is written in the same
transaction as the change that caused it, with a notification that wakes the drain once the
transaction commits.

Marking again an existing mark re-arms it rather than adding a row: `created_at` moves forward,
so a reconcile already running for the older change doesn't delete it on success (see drain.py).
"""

from collections.abc import Iterable

from sqlalchemy import func, or_, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.discord.links import CHANNEL
from app.models.discord import DiscordGuildLink, DiscordSyncMark
from app.models.models import (
    OAuthIdentity,
    OAuthProvider,
    Tournament,
    TournamentMembership,
    TournamentTrackAssignment,
)


def _mark(db: Session, link_id: int, kind: str, discord_user_id: int | None) -> None:
    statement = insert(DiscordSyncMark).values(
        link_id=link_id,
        kind=kind,
        discord_user_id=discord_user_id,
        attempts=0,
        next_attempt_at=func.clock_timestamp(),
        created_at=func.clock_timestamp(),
    )
    db.execute(
        statement.on_conflict_do_update(
            constraint="uq_discord_sync_mark",
            set_={
                "attempts": 0,
                "next_attempt_at": func.clock_timestamp(),
                "created_at": func.clock_timestamp(),
            },
        )
    )
    db.execute(text("SELECT pg_notify(:channel, '')"), {"channel": CHANNEL})


def mark_member(db: Session, link_id: int, discord_user_id: int) -> None:
    _mark(db, link_id, "member", discord_user_id)


def mark_structure(db: Session, link_id: int) -> None:
    _mark(db, link_id, "structure", None)


def mark_full(db: Session, link_id: int) -> None:
    _mark(db, link_id, "full", None)


def syncing_links(
    db: Session, tournament_id: int, track_ids: Iterable[int] | None = None
) -> list[DiscordGuildLink]:
    """The tournament's built servers the bot is still in; with `track_ids`, only theirs."""
    query = db.query(DiscordGuildLink).filter(
        DiscordGuildLink.tournament_id == tournament_id,
        DiscordGuildLink.built_at.isnot(None),
        DiscordGuildLink.bot_removed_at.is_(None),
    )
    if track_ids is not None:
        query = query.filter(DiscordGuildLink.track_id.in_(list(track_ids)))
    return query.all()


def discord_accounts(db: Session, user_ids: Iterable[int]) -> dict[int, int]:
    """NEXUS user id -> linked Discord user id, for those that have one."""
    rows = db.query(OAuthIdentity.user_id, OAuthIdentity.provider_account_id).filter(
        OAuthIdentity.provider == OAuthProvider.discord,
        OAuthIdentity.user_id.in_(list(user_ids)),
    )
    return {user_id: int(account) for user_id, account in rows}


def mark_servers(db: Session, tournament_id: int, kind: str, track_id: int | None = None) -> None:
    """A structure or full mark on every server of the tournament, or on one track's."""
    for link in syncing_links(db, tournament_id, None if track_id is None else [track_id]):
        _mark(db, link.id, kind, None)


def mark_users(
    db: Session, tournament_id: int, user_ids: Iterable[int], track_ids: Iterable[int | None]
) -> None:
    """Member marks for these users in the servers of these tracks. A None track means a
    tournament-wide row, which counts in every server of the tournament."""
    user_ids, track_ids = set(user_ids), set(track_ids)
    if not user_ids or not track_ids:
        return
    tracks = None if None in track_ids else {t for t in track_ids if t is not None}
    links = syncing_links(db, tournament_id, tracks)
    if not links:
        return
    accounts = discord_accounts(db, user_ids)
    for link in links:
        for account in accounts.values():
            mark_member(db, link.id, account)


def mark_memberships(
    db: Session, tournament_id: int, scopes: Iterable[tuple[int, int | None]]
) -> None:
    """Member marks from assignment rows, as (membership id, track id or None if tournament-wide)."""
    by_membership: dict[int, set[int | None]] = {}
    for membership_id, track_id in scopes:
        by_membership.setdefault(membership_id, set()).add(track_id)
    if not by_membership:
        return
    users = dict(
        db.query(TournamentMembership.id, TournamentMembership.user_id).filter(
            TournamentMembership.id.in_(list(by_membership))
        )
    )
    for membership_id, track_ids in by_membership.items():
        if membership_id in users:
            mark_users(db, tournament_id, [users[membership_id]], track_ids)


def row_scope(row: TournamentTrackAssignment) -> tuple[int, int | None]:
    return row.membership_id, None if row.is_tournament_wide else row.tournament_track_id


def mark_role_holders(db: Session, tournament_id: int, role_id: int) -> None:
    rows = db.query(TournamentTrackAssignment).filter(TournamentTrackAssignment.role_id == role_id)
    mark_memberships(db, tournament_id, (row_scope(r) for r in rows))


def mark_event_staff(
    db: Session, tournament_id: int, event_id: int, track_ids: Iterable[int] | None = None
) -> None:
    """Member marks for everyone assigned to this event, on these tracks or all of them."""
    query = db.query(TournamentTrackAssignment).filter(
        TournamentTrackAssignment.tournament_event_id == event_id
    )
    if track_ids is not None:
        query = query.filter(TournamentTrackAssignment.tournament_track_id.in_(list(track_ids)))
    mark_memberships(db, tournament_id, (row_scope(r) for r in query))


def mark_account_everywhere(db: Session, user_id: int, discord_user_id: int) -> None:
    """Member marks for one Discord account in every server where its NEXUS user counts: tracks
    they hold a role on, every server of a tournament where they hold a tournament-wide role or
    which they own. Member lists are never scanned."""
    rows = (
        db.query(
            TournamentMembership.tournament_id,
            TournamentTrackAssignment.tournament_track_id,
            TournamentTrackAssignment.is_tournament_wide,
        )
        .join(
            TournamentTrackAssignment,
            TournamentTrackAssignment.membership_id == TournamentMembership.id,
        )
        .filter(TournamentMembership.user_id == user_id)
        .distinct()
        .all()
    )
    wide = {t for t, _, is_wide in rows if is_wide}
    wide |= {t for (t,) in db.query(Tournament.id).filter(Tournament.owner_id == user_id)}
    tracks = {track for t, track, is_wide in rows if not is_wide and t not in wide and track}
    query = db.query(DiscordGuildLink).filter(
        DiscordGuildLink.built_at.isnot(None),
        DiscordGuildLink.bot_removed_at.is_(None),
        or_(
            DiscordGuildLink.tournament_id.in_(list(wide)),
            DiscordGuildLink.track_id.in_(list(tracks)),
        ),
    )
    for link in query:
        mark_member(db, link.id, discord_user_id)


def mark_user_everywhere(db: Session, user_id: int) -> None:
    """mark_account_everywhere for the user's own linked account, if any."""
    account = discord_accounts(db, [user_id]).get(user_id)
    if account is not None:
        mark_account_everywhere(db, user_id, account)
