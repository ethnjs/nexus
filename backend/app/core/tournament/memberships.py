from __future__ import annotations
from typing import TYPE_CHECKING

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.models.models import TournamentMembership, TournamentMembershipRole, User
# Safe at module scope where the tournament schemas aren't: person.py sits at
# the bottom of the import graph on purpose (see its docstring).
from app.schemas.person import PersonRefResponse, PersonRoleRead

if TYPE_CHECKING:
    # Annotations only. Every one of these is imported for real inside the
    # builder that uses it, because importing them here at runtime cycles:
    # schemas/tournament/membership.py -> schemas/tournament/role.py ->
    # core/tournament/permissions.py -> back to this module.
    from app.schemas.tournament.membership import (
        MembershipCustomAnswerRead, MembershipEventPreferenceRead, MembershipLunchRead,
    )
    from app.schemas.tournament.track import MembershipTrackStatusRead

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

def resolve_person_refs(
    db: Session, tournament_id: int, user_ids: set[int],
) -> dict[int, PersonRefResponse]:
    """
    Resolve a batch of user ids to name-and-roles references, for any response
    that surfaces "who did this" — join-code creators, audit log actors, form
    authors.

    Returns one shape, not a union. It used to hand back a whole
    the whole roster for anyone with a membership, which meant every
    "invited by" line carried that person's email, phone, age flags, lunch
    choices and custom form answers — and their age flags never passed
    through gate_age_flags on the way. `roles=None` now carries the "no
    membership in this tournament" fact the bare-user branch used to.
    """
    memberships = (
        db.query(TournamentMembership)
        .options(
            selectinload(TournamentMembership.roles).selectinload(TournamentMembershipRole.role),
            selectinload(TournamentMembership.user),
        )
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id.in_(user_ids),
        )
        .all()
    )
    resolved: dict[int, PersonRefResponse] = {
        m.user_id: PersonRefResponse(
            user_id=m.user_id,
            membership_id=m.id,
            first_name=m.user.first_name,
            last_name=m.user.last_name,
            roles=[PersonRoleRead(id=mr.role.id, label=mr.role.label) for mr in m.roles],
        )
        for m in memberships
    }
    missing_ids = user_ids - resolved.keys()
    if missing_ids:
        users = db.query(User).filter(User.id.in_(missing_ids)).all()
        resolved.update({
            u.id: PersonRefResponse(user_id=u.id, first_name=u.first_name, last_name=u.last_name)
            for u in users
        })
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


def delete_tournament_form_responses(db: Session, tournament_id: int, user_id: int) -> int:
    """Delete this user's responses to forms owned by `tournament_id`.

    FormResponse is keyed by (form_id, user_id), never by membership, so
    removing someone from a tournament otherwise leaves their responses
    behind: the roster no longer shows them, but the rows still count
    toward a form's response_count (which blocks deleting the form) and
    still occupy the unique (form_id, user_id) slot, so rejoining lands the
    member on answers they can no longer see. Call this wherever a
    membership is hard-deleted.

    Scoped to tournament-owned forms on purpose — a chapter form's
    responses belong to the chapter and outlive any one tournament.

    Answers and pending-update flags go with each response through their own
    FK cascades, which is why this can be a bulk delete. Does not commit:
    the caller's own delete + commit is the unit of work.
    """
    from app.models.models import Form, FormResponse

    doomed = (
        db.query(FormResponse.id)
        .join(Form, FormResponse.form_id == Form.id)
        .filter(
            FormResponse.user_id == user_id,
            Form.owner_type == "tournament",
            Form.tournament_id == tournament_id,
        )
        .scalar_subquery()
    )
    return (
        db.query(FormResponse)
        .filter(FormResponse.id.in_(doomed))
        .delete(synchronize_session=False)
    )


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

    type_by_key: dict[str, str] = {}
    for field_key, question_type in (
        db.query(FormField.field_key, FormField.question_type)
        .join(Form, FormField.form_id == Form.id)
        .filter(
            Form.owner_type == "tournament",
            Form.tournament_id == membership.tournament_id,
            FormField.field_key.in_({field_key_for(row) for row in rows}),
        )
        # Live fields first, then setdefault, so a live question wins over an
        # archived one sharing its key — an archived field doesn't reserve its
        # key, so both can exist at once, and question_type decides whether a
        # row renders as free text or a badge. Same idiom as
        # build_event_preferences.
        .order_by(FormField.is_archived, FormField.id)
    ):
        type_by_key.setdefault(field_key, question_type)

    return [
        MembershipLunchRead(
            date=row.date,
            category=row.category,
            value=row.value,
            question_type=type_by_key.get(field_key_for(row)),
        )
        for row in rows
    ]


PENDING_TRACK_STATUS = "pending"


def build_track_statuses(db: Session, membership: TournamentMembership) -> list["MembershipTrackStatusRead"]:
    """Every track this member could hold a status on, not just the ones they
    do — a track with no row reads as "pending" rather than being absent.

    Absence is ambiguous on its own: "hasn't answered yet" and "this track
    doesn't exist" look identical to a panel, so a coordinator can't tell who
    still owes an answer. Padding the list makes the gap explicit.

    Archived tracks are padded out of, not into, the list: a retired track the
    member never engaged with isn't pending anything. One they *do* have a row
    for still appears, since that history stays readable (see
    MembershipTrackStatusRead).

    Display config filtering runs after this and keys off track_id, so a
    hidden track drops out whether or not it had a row."""
    from app.models.models import TournamentTrack
    from app.schemas.tournament.track import MembershipTrackStatusRead

    existing = {row.track_id: row for row in membership.track_statuses}
    live_tracks = (
        db.query(TournamentTrack)
        .filter(
            TournamentTrack.tournament_id == membership.tournament_id,
            TournamentTrack.is_archived == False,
        )
        .all()
    )

    entries = [
        MembershipTrackStatusRead.from_row(row) for row in membership.track_statuses
    ] + [
        MembershipTrackStatusRead(
            track_id=track.id,
            name=track.name,
            is_archived=track.is_archived,
            status=PENDING_TRACK_STATUS,
            allow_confirm=track.allow_confirm,
        )
        for track in live_tracks
        if track.id not in existing
    ]
    return sorted(entries, key=lambda e: e.name)


def enrich_table_columns(db: Session, tournament, config: dict | None, memberships: list, responses: list) -> None:
    """Fills in the roster fields the members table's saved column config
    asks for, and only those.

    A roster is every member in the tournament, so this is the difference
    between one extra query and none at all — not between one and N. Each kind
    of data is fetched for the whole roster in a single query and then handed
    out, never per membership.

    Mutates `responses` in place, positionally paired with `memberships`."""
    from app.core.tournament import tournament_local_date
    from app.core.tournament.display_config import (
        AVAILABILITY_DAY_NAMESPACE, COLUMN_AGE, DEFAULT_COLUMNS,
        FORM_FIELD_NAMESPACE, LUNCH_CATEGORY_NAMESPACE, MEMBERS_TABLE,
    )
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift,
    )

    surface = (config or {}).get(MEMBERS_TABLE) or {}
    columns = surface.get("columns")
    if columns is None:
        columns = list(DEFAULT_COLUMNS)
    if not columns or not memberships:
        return

    wants_age = COLUMN_AGE in columns
    wants_availability = any(c.startswith(AVAILABILITY_DAY_NAMESPACE) for c in columns)
    wants_lunch = any(c.startswith(LUNCH_CATEGORY_NAMESPACE) for c in columns)
    wants_custom = any(c.startswith(FORM_FIELD_NAMESPACE) for c in columns)

    membership_ids = [m.id for m in memberships]

    if wants_availability:
        from app.schemas.tournament.membership import MembershipAvailabilityRead

        # The shift's start is an instant; column keys are tournament-local
        # days — same conversion build_catalog used to name them.
        rows = (
            db.query(
                TournamentMembershipAvailability.membership_id,
                TournamentShift.id, TournamentShift.label,
                TournamentShift.start, TournamentShift.end,
            )
            .join(TournamentShift, TournamentMembershipAvailability.tournament_shift_id == TournamentShift.id)
            .filter(TournamentMembershipAvailability.membership_id.in_(membership_ids))
            .order_by(TournamentShift.start)
            .all()
        )
        shifts_by_membership: dict[int, list] = {}
        for membership_id, shift_id, label, start, end in rows:
            shifts_by_membership.setdefault(membership_id, []).append(
                MembershipAvailabilityRead(
                    shift_id=shift_id,
                    label=label,
                    start=start,
                    end=end,
                    day=tournament_local_date(tournament, start).isoformat(),
                )
            )
    if wants_lunch:
        lunch_by_membership: dict[int, list] = {}
        for row in db.query(TournamentMembershipLunch).filter(
            TournamentMembershipLunch.membership_id.in_(membership_ids)
        ):
            lunch_by_membership.setdefault(row.membership_id, []).append(row)

    for membership, response in zip(memberships, responses):
        if wants_age:
            response.is_over_18 = membership.is_over_18
            response.is_over_21 = membership.is_over_21
        if wants_availability:
            response.availability = shifts_by_membership.get(membership.id, [])
        if wants_lunch:
            response.lunch = build_lunch_rows(lunch_by_membership.get(membership.id, []))
        if wants_custom:
            response.custom_responses = get_custom_form_answers(
                db, tournament.id, membership.user_id
            )


def build_lunch_rows(rows) -> list["MembershipLunchRead"]:
    """The plain read shape for lunch rows already in hand — no question_type
    lookup, unlike build_lunch. The table keys off `category`, which the row
    itself carries, so the source question's type is irrelevant there."""
    from app.schemas.tournament.membership import MembershipLunchRead

    return [
        MembershipLunchRead(date=row.date, category=row.category, value=row.value)
        for row in rows
    ]
