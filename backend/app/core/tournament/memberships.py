from __future__ import annotations
from typing import TYPE_CHECKING

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.models import TournamentMembership, User

# A declined membership's row survives (2.4c is a soft decline), but it must
# read as inactive everywhere a roster/count/access-check enumerates members.
# NULL-safe on purpose: most rows have `age_disclosure IS NULL` (never
# collected, or unanswered), and a plain `!= "declined"` filter would silently
# drop every one of those too, since SQL NULL comparisons are never true —
# this would have hidden almost the entire roster. Use this in every
# SQL-level filter; is_declined() below is the equivalent for an
# already-loaded ORM object.
ACTIVE_MEMBERSHIP_CLAUSE = or_(
    TournamentMembership.age_disclosure.is_(None),
    TournamentMembership.age_disclosure != "declined",
)


def is_declined(membership: "TournamentMembership") -> bool:
    """Python-side equivalent of ACTIVE_MEMBERSHIP_CLAUSE for an
    already-loaded row — no NULL-comparison hazard here since this is a
    plain Python `==`, not SQL."""
    return membership.age_disclosure == "declined"

if TYPE_CHECKING:
    # Deferred to a lazy import inside resolve_memberships_or_users() below —
    # schemas/tournament/membership.py -> schemas/tournament/role.py ->
    # core/tournament/permissions.py -> back to this module at import time.
    from app.schemas.tournament.membership import MembershipCustomAnswerRead, MembershipSlimResponse
    from app.schemas.user import UserSlimResponse

def get_membership_by_user(db: Session, tournament_id: int, user_id: int, *options) -> TournamentMembership | None:
    """
    Fetch a membership by (tournament_id, user_id) rather than by membership
    id — the .../memberships/me/ routes' lookup shape. Nullable, not a 404
    helper: callers that must 404 on a missing row do that themselves
    (get_my_membership's GET route instead synthesizes a response for the
    admin-without-a-row case).
    """
    query = db.query(TournamentMembership).filter(
        TournamentMembership.tournament_id == tournament_id,
        TournamentMembership.user_id == user_id,
    )
    if options:
        query = query.options(*options)
    return query.first()

def resolve_memberships_or_users(
    db: Session, tournament_id: int, user_ids: set[int],
) -> dict[int, MembershipSlimResponse | UserSlimResponse]:
    """
    Resolve a batch of user ids to their TournamentMembership in this
    tournament, falling back to the bare User for ids with no membership row
    (e.g. a site admin acting without ever joining). Shared by any response
    that surfaces "who did this" — join-code creators, audit log actors.
    """
    from app.schemas.tournament.membership import MembershipSlimResponse
    from app.schemas.user import UserSlimResponse

    memberships = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id.in_(user_ids),
        )
        .all()
    )
    resolved: dict[int, MembershipSlimResponse | UserSlimResponse] = {
        m.user_id: MembershipSlimResponse.model_validate(m) for m in memberships
    }
    missing_ids = user_ids - resolved.keys()
    if missing_ids:
        users = db.query(User).filter(User.id.in_(missing_ids)).all()
        resolved.update({u.id: UserSlimResponse.model_validate(u) for u in users})
    return resolved


def has_any_membership(user: "User", tournament_id: int, db: Session) -> bool:
    """Return True if the user has any *active* membership in
    `tournament_id`. A declined membership counts as none — this is the
    central choke point behind require_membership()/require_permission(),
    so a declined member is blocked from tournament pages generally
    (events, forms, roster, staff routes) without every call site needing
    its own check. The one deliberate exception is GET/POST
    .../memberships/me/(age-disclosure)/, which bypass this dependency
    entirely so a declined member can still see their own status and
    re-consent — see those routes."""
    if user.role == "admin":
        return True
    membership = get_membership_by_user(db, tournament_id, user.id)
    return membership is not None and not is_declined(membership)


def gate_age_flags(membership: TournamentMembership | None, data: dict) -> dict:
    """Drops `is_over_18`/`is_over_21` from a serialized membership response
    dict unless the tournament collects that specific flag AND this
    membership has consented (`age_disclosure == "consented"`). Omitted
    entirely rather than sent as `null` — a careless frontend reading
    `null` as "under 18" would be exactly backwards. Applies identically
    regardless of viewer permission: manage_members does not override a
    member's withheld consent (see TASK.md 2.5)."""
    consented = membership is not None and membership.age_disclosure == "consented"
    tournament = membership.tournament if membership is not None else None
    if not (consented and tournament is not None and tournament.collect_is_over_18):
        data.pop("is_over_18", None)
    if not (consented and tournament is not None and tournament.collect_is_over_21):
        data.pop("is_over_21", None)
    return data


def get_custom_form_answers(db: Session, tournament_id: int, user_id: int) -> list["MembershipCustomAnswerRead"]:
    """This user's answers to non-reserved fields on published,
    tournament-owned forms in `tournament_id`. 'Custom' = field_key matches
    none of the availability_/event_preference_/lunch_/track_status_
    presets — those already have dedicated structural fields elsewhere on
    MembershipFullResponse. FormResponse is keyed by user_id, not
    membership_id (see TASK.md's known pre-existing issue note), so this
    joins on the user directly rather than through the membership."""
    from app.core.form.validation import TOURNAMENT_PRESET_FIELD_KEY_PATTERNS
    from app.models.models import Form, FormAnswer, FormField, FormResponse
    from app.schemas.tournament.membership import MembershipCustomAnswerRead

    rows = (
        db.query(FormAnswer, FormField, Form)
        .join(FormField, FormAnswer.field_id == FormField.id)
        .join(Form, FormField.form_id == Form.id)
        .join(FormResponse, FormAnswer.response_id == FormResponse.id)
        .filter(
            FormResponse.user_id == user_id,
            Form.owner_type == "tournament",
            Form.tournament_id == tournament_id,
            Form.status == "published",
        )
        .all()
    )

    return [
        MembershipCustomAnswerRead(
            form_title=form.title or form.name,
            field_label=field.label,
            question_type=field.question_type,
            value=answer.value,
        )
        for answer, field, form in rows
        if not any(pattern.match(field.field_key) for pattern in TOURNAMENT_PRESET_FIELD_KEY_PATTERNS)
    ]
