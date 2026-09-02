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
            field_key=field.field_key,
            question_type=field.question_type,
            value=answer.value,
            field_id=field.id,
        )
        for answer, field, form in rows
        if not any(pattern.match(field.field_key) for pattern in TOURNAMENT_PRESET_FIELD_KEY_PATTERNS)
    ]


def build_event_preferences(db: Session, membership: TournamentMembership) -> list["MembershipEventPreferenceRead"]:
    """This membership's event preferences, grouped by the *form option* they
    picked rather than the flat per-event rows the DB stores.

    Selecting one option writes one row per event it groups (see
    form-question-types-reference.md), so a "Test Review" option covering 21
    events reads back as 21 rows — unusable in a panel. This reverses that
    expansion by mapping each stored event id back to the option whose `value`
    list contains it, and returns one entry per option with its events nested.

    Options are matched against archived fields and archived options too, not
    just live ones: an answer given before the TD reworked the question still
    has to render. Anything matched that way is flagged `is_archived` so the
    UI can warn that the answer is out of date; an event matching no option at
    all falls back to a single-event group, also flagged."""
    from app.core.form.validation import EVENT_PREFERENCE_FIELD_KEY_PATTERN
    from app.models.models import Form, FormField
    from app.schemas.tournament.membership import (
        MembershipEventPreferenceEventRead,
        MembershipEventPreferenceOptionRead,
        MembershipEventPreferenceRead,
    )

    rows = membership.event_preferences
    if not rows:
        return []

    keys = {row.key for row in rows}
    fields = (
        db.query(FormField)
        .join(Form, FormField.form_id == Form.id)
        .filter(
            Form.owner_type == "tournament",
            Form.tournament_id == membership.tournament_id,
            FormField.field_key.in_({f"event_preference_{key}" for key in keys}),
        )
        # Live fields first so a live option wins the mapping over an archived
        # field that shares the key — an archived field doesn't reserve its
        # key, so both can exist at once.
        .order_by(FormField.is_archived, FormField.id)
        .all()
    )

    # event id -> (key, option_id, label, order, is_archived)
    option_by_event: dict[tuple[str, int], dict] = {}
    for field in fields:
        if not EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key):
            continue
        key = field.field_key[len("event_preference_"):]
        for order, option in enumerate((field.config or {}).get("options", [])):
            value = option.get("value")
            if not isinstance(value, list):
                continue
            for event_id in value:
                option_by_event.setdefault((key, event_id), {
                    "option_id": option.get("option_id"),
                    "label": option.get("label") or "",
                    "order": order,
                    "is_archived": bool(option.get("is_archived") or field.is_archived),
                })

    groups: list[MembershipEventPreferenceRead] = []
    for key in sorted(keys):
        key_rows = sorted(
            (row for row in rows if row.key == key),
            key=lambda r: (r.rank is None, r.rank or 0, r.tournament_event_id),
        )

        # option_id is only unique within a field, and an orphan has none, so
        # the bucket key falls back to the event id to keep orphans separate.
        buckets: dict[object, dict] = {}
        for row in key_rows:
            event = MembershipEventPreferenceEventRead(
                id=row.tournament_event_id,
                name=row.tournament_event.display_name,
                division=row.tournament_event.division,
                rank=row.rank,
            )
            match = option_by_event.get((key, row.tournament_event_id))
            bucket_id = match["option_id"] if match else f"event:{row.tournament_event_id}"
            bucket = buckets.get(bucket_id)
            if bucket:
                bucket["events"].append(event)
                continue
            buckets[bucket_id] = {
                "option_id": match["option_id"] if match else None,
                # An orphan has no option to name it, so it labels itself.
                "label": match["label"] if match else (event.name or "Unknown event"),
                "order": match["order"] if match else len(option_by_event) + row.tournament_event_id,
                "is_archived": match["is_archived"] if match else True,
                "rank": row.rank,
                "events": [event],
            }

        groups.append(MembershipEventPreferenceRead(
            key=key,
            options=[
                MembershipEventPreferenceOptionRead(**{k: v for k, v in bucket.items() if k != "order"})
                for bucket in sorted(
                    buckets.values(),
                    key=lambda b: (b["rank"] is None, b["rank"] or 0, b["order"]),
                )
            ],
        ))
    return groups


def build_lunch(db: Session, membership: TournamentMembership) -> list["MembershipLunchRead"]:
    """This membership's lunch rows, each carrying the question_type of the
    question that produced it.

    The row itself can't tell you: a typed short_text answer and a picked
    option both land in the same value/label columns. The type lives on the
    FormField whose field_key is `lunch_{YYYYMMDD}_{category}`, so this maps
    rows back to fields by reconstructing that key. Archived fields count too
    — an answer given before the question was retired still has to render the
    way it was written."""
    from app.models.models import Form, FormField
    from app.schemas.tournament.membership import MembershipLunchRead

    rows = membership.lunch_selections
    if not rows:
        return []

    def field_key_for(row) -> str:
        return f"lunch_{row.date.strftime('%Y%m%d')}_{row.category}"

    type_by_key = dict(
        db.query(FormField.field_key, FormField.question_type)
        .join(Form, FormField.form_id == Form.id)
        .filter(
            Form.owner_type == "tournament",
            Form.tournament_id == membership.tournament_id,
            FormField.field_key.in_({field_key_for(row) for row in rows}),
        )
    )

    return [
        MembershipLunchRead(
            date=row.date,
            category=row.category,
            value=row.value,
            question_type=type_by_key.get(field_key_for(row)),
        )
        for row in rows
    ]
