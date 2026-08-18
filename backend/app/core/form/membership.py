from sqlalchemy.orm import Session

from app.models.models import ChapterMembership, Form, TournamentMembership, TournamentMembershipRole, User

# ---------------------------------------------------------------------------
# creates_membership_on_submit side effect. Called only on a user's FIRST
# response to a form — resubmission never touches membership.
# ---------------------------------------------------------------------------


def create_membership_on_first_submit(db: Session, form: Form, user: User) -> None:
    if not form.creates_membership_on_submit:
        return

    if form.owner_type == "tournament":
        _create_tournament_membership(db, form, user)
    else:
        _create_chapter_membership(db, form, user)


def _create_tournament_membership(db: Session, form: Form, user: User) -> None:
    existing = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == form.tournament_id,
        )
        .first()
    )
    if existing:
        return

    config = form.tournament_membership_config
    status_value = (config.status_on_submit if config else None) or "interested"

    membership = TournamentMembership(
        user_id=user.id,
        tournament_id=form.tournament_id,
        source="manual",
        status=status_value,
    )
    db.add(membership)
    db.flush()

    role_ids = config.role_ids_on_submit if config and config.role_ids_on_submit else []
    for role_id in role_ids:
        db.add(TournamentMembershipRole(membership_id=membership.id, role_id=role_id))


def _create_chapter_membership(db: Session, form: Form, user: User) -> None:
    # ChapterMembership.user_id is unique — a user belongs to at most one
    # chapter total, so this checks for ANY existing chapter membership,
    # not just one scoped to form.chapter_id.
    existing = db.query(ChapterMembership).filter(ChapterMembership.user_id == user.id).first()
    if existing:
        return

    config = form.chapter_membership_config
    role_value = config.role_on_submit if config else "member"

    db.add(ChapterMembership(chapter_id=form.chapter_id, user_id=user.id, role=role_value))
