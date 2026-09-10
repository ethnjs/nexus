"""Seed realistic member data for a tournament in a dev/preview database.

The point of this script is that it does **not** write the derived tables
(track statuses, availability, event preferences) itself. Those are produced by
replaying real form submissions through the same helpers the
POST /forms/{id}/responses/ route uses, so the result obeys the onboarding
forms' branching and required rules. Writing them directly is how you end up
with states no respondent could have reached — a member "interested" in test
writing with no test-writing event preference, or availability on a day they
declined.

Everything is looked up by name/ownership rather than hardcoded id, so the same
invocation works against any database.

    python -m app.db.seed_members --tournament 3
    python -m app.db.seed_members --tournament 3 --no-onboarding
    python -m app.db.seed_members --tournament 3 --email-prefix member --seed 7

Run from backend/ with the venv active.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import date

from sqlalchemy.orm import Session

from app.core.config import get_settings

# ---------------------------------------------------------------------------
# Value pools. Nothing here is an id — every id this script writes is resolved
# from the target database at runtime.
# ---------------------------------------------------------------------------

PRONOUNS = ["she/her", "he/him", "they/them", "she/they", "he/they", "any pronouns", ""]
MAJORS = [
    "Biology", "Chemistry", "Mechanical Engineering", "Computer Science", "Physics",
    "Neuroscience", "Environmental Science", "Applied Mathematics", "Cognitive Science",
    "Public Health", "Geology", "Biochemistry", "Aerospace Engineering", "Data Science",
    "Civil Engineering", "Molecular Biology", "Statistics", "Astrophysics",
    "Materials Science", "Human Biology", "Undeclared",
]
EMPLOYERS = [
    "Northrop Grumman", "Kaiser Permanente", "Irvine Unified School District",
    "JPL", "Edwards Lifesciences", "Self-employed",
]
# Weighted toward blank: most people have no dietary restriction.
DIETS = [
    "", "", "", "", "Vegetarian", "Vegan", "Gluten-free", "No pork",
    "Peanut allergy", "Lactose intolerant", "Halal", "Shellfish allergy",
]
SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"]
AREA_CODES = [562, 714, 626, 949, 310, 909]
SCHOOLS = [
    "Northwood High School", "Troy High School", "Glen A. Wilson High School",
    "Irvine High School", "University High School", "Mission San Jose High School",
    "Canyon Crest Academy", "Arcadia High School",
]
PAST_TOURNAMENTS = [
    "OC Regionals", "SoCal States", "Nationals", "LA Regionals",
    "Temple City Invitational", "Golden Gate Invitational",
]
VOLUNTEER_ROLES = [
    "Volunteer", "Event Supervisor", "Lead Event Supervisor", "Runner",
    "Scoring", "Test Writer", "Tournament Staff",
]
MEMBERSHIP_NOTES = [
    None, None, None, "Returning volunteer", "Prefers morning shifts",
    "Needs parking pass", "First-time volunteer",
]
COMPETITION_NOTES = [None, None, "Medaled at states", "Two seasons"]
STUDENT_STATUSES = ["Undergraduate", "Graduate", "Non-Student"]
STUDENT_STATUS_WEIGHTS = [13, 5, 3]


class FakeUser:
    """`_write_through_reserved_fields` only reads `.id` off `current_user`."""

    def __init__(self, user_id: int) -> None:
        self.id = user_id


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

def seed_profile(rng: random.Random, user, university_ids: list[int], reference_year: int) -> None:
    """Overwrite one user's profile fields with an internally consistent set.

    Consistency matters more than variety: a graduation year has to agree with
    the year level, and a birth date with both, or member-list filters produce
    nonsense that looks like a bug in the filter.
    """
    status = rng.choices(STUDENT_STATUSES, STUDENT_STATUS_WEIGHTS)[0]

    if status == "Undergraduate":
        year_level = rng.randint(1, 4)
        graduation_year = reference_year + (4 - year_level)
        birth_year = reference_year - (18 + year_level)
        employer = None
    elif status == "Graduate":
        year_level = rng.randint(1, 5)
        graduation_year = reference_year + rng.randint(0, 3)
        birth_year = reference_year - rng.randint(25, 30)
        employer = None
    else:
        year_level = None
        graduation_year = rng.choice([None, reference_year - rng.randint(3, 17)])
        birth_year = reference_year - rng.randint(26, 42)
        employer = rng.choice(EMPLOYERS)

    user.student_status = status
    user.year_level = year_level
    user.graduation_year = graduation_year
    user.employer = employer
    user.date_of_birth = date(birth_year, rng.randint(1, 12), rng.randint(1, 28))
    user.phone = f"{rng.choice(AREA_CODES)}{rng.randint(2000000, 9999999)}"
    user.shirt_size = rng.choice(SHIRT_SIZES)
    user.dietary_restriction = rng.choice(DIETS)
    user.major = rng.choice(MAJORS)
    user.pronouns = rng.choice(PRONOUNS)
    user.university_id = rng.choice(university_ids) if university_ids else None
    user.has_competition_experience = rng.random() < 0.6
    user.has_volunteer_experience = rng.random() < 0.55


def seed_experience(rng: random.Random, db: Session, user, catalog_event_ids: list[int]) -> None:
    """Prior competition/volunteer history, gated on the profile's own flags —
    rows that contradict `has_*_experience` read as a sync bug."""
    from app.models.models import UserCompetitionExperience, UserVolunteerExperience

    db.query(UserCompetitionExperience).filter(UserCompetitionExperience.user_id == user.id).delete()
    db.query(UserVolunteerExperience).filter(UserVolunteerExperience.user_id == user.id).delete()

    if user.has_competition_experience and catalog_event_ids:
        school = rng.choice(SCHOOLS)
        for event_id in rng.sample(catalog_event_ids, min(rng.randint(1, 4), len(catalog_event_ids))):
            db.add(UserCompetitionExperience(
                user_id=user.id,
                event_id=event_id,
                school=school,
                notes=rng.choice(COMPETITION_NOTES),
            ))

    if user.has_volunteer_experience:
        for _ in range(rng.randint(1, 3)):
            db.add(UserVolunteerExperience(
                user_id=user.id,
                tournament_name=rng.choice(PAST_TOURNAMENTS),
                year=rng.randint(2022, 2026),
                event_id=rng.choice(catalog_event_ids) if catalog_event_ids and rng.random() < 0.6 else None,
                role=rng.choice(VOLUNTEER_ROLES),
            ))


# ---------------------------------------------------------------------------
# Onboarding — answer generation and submission replay
# ---------------------------------------------------------------------------

def pick_answer(rng: random.Random, field):
    """A plausible answer for one field, in the raw (pre-snapshot) shape the
    submit route accepts: an option_id for single-select, a list of them for
    multi-select, a {rank: option_id} map for ranked_choice."""
    config = field.config or {}

    # The option-less types first — the guard below would swallow them.
    # An unconfirmed acknowledgment submits False, which reads as blank, so a
    # required one has to be True.
    if field.question_type == "acknowledgment":
        return True
    if field.question_type in ("short_text", "long_text"):
        return rng.choice(["No notes", "Happy to help wherever needed", "Parking question"])

    options = [o for o in config.get("options", []) if not o.get("is_archived")]
    if not options:
        return None

    if field.question_type == "ranked_choice":
        ranks = config.get("ranks") or 3
        picked = rng.sample(options, min(ranks, len(options)))
        return {str(i + 1): option["option_id"] for i, option in enumerate(picked)}

    if field.question_type == "multi_select_checkbox":
        return [o["option_id"] for o in rng.sample(options, rng.randint(1, min(3, len(options))))]

    return rng.choice(options)["option_id"]


def build_answers(rng: random.Random, fields: list) -> dict:
    """Walk the form the way a respondent does: answer the current question,
    let that answer decide what comes next, stop where the walk stops.

    Recomputing reachability after every pick is the whole trick — it's what
    keeps a "No" answer from also carrying answers to the questions it skips,
    and what guarantees a required follow-up (test-writing interest implying an
    event preference) is always present.
    """
    from app.core.form.branching import compute_reachable_field_ids

    by_order = sorted(fields, key=lambda f: f.order)
    answers: dict = {}
    while True:
        reachable = compute_reachable_field_ids(fields, answers)
        pending = [f for f in by_order if f.id in reachable and f.id not in answers]
        if not pending:
            return answers
        answers[pending[0].id] = pick_answer(rng, pending[0])


def submit_response(db: Session, form, membership, answers_by_field: dict, active_fields: list):
    """Persist one response through the real submission helpers."""
    from app.api.routes.forms import _store_answers, _write_through_reserved_fields
    from app.core.form.branching import missing_required_field_keys
    from app.models.models import FormResponse
    from app.schemas.form import FormAnswerCreate

    missing = missing_required_field_keys(active_fields, answers_by_field)
    if missing:
        raise SystemExit(
            f"generated an invalid response for user {membership.user_id} "
            f"on form {form.id}: missing {sorted(missing)}"
        )

    response = FormResponse(form_id=form.id, user_id=membership.user_id)
    db.add(response)
    db.flush()

    payload = [FormAnswerCreate(field_id=fid, value=value) for fid, value in answers_by_field.items()]
    _store_answers(db, response, {f.id: f for f in active_fields}, payload)
    _write_through_reserved_fields(
        db, form, active_fields, answers_by_field, FakeUser(membership.user_id), response
    )
    return response


def reset_onboarding(db: Session, form_ids: list[str], user_ids: list[int], membership_ids: list[int]) -> None:
    """Clear what a resubmission legally can't overwrite.

    Track status is upsert-only (`sync_track_statuses` never deletes, and
    confirmed -> interested is refused outright), and a second POST for the
    same (form, user) is a 409 — so reseeding on top of existing rows would
    silently blend two runs together.
    """
    from app.models.models import (
        FormAnswer,
        FormResponse,
        TournamentMembership,
        TournamentMembershipAvailability,
        TournamentMembershipEventPreference,
        TournamentMembershipLunch,
        TournamentMembershipTrackStatus,
    )

    response_ids = db.query(FormResponse.id).filter(
        FormResponse.form_id.in_(form_ids),
        FormResponse.user_id.in_(user_ids),
    )
    db.query(FormAnswer).filter(FormAnswer.response_id.in_(response_ids)).delete(synchronize_session=False)
    db.query(FormResponse).filter(
        FormResponse.form_id.in_(form_ids),
        FormResponse.user_id.in_(user_ids),
    ).delete(synchronize_session=False)

    for model in (
        TournamentMembershipTrackStatus,
        TournamentMembershipAvailability,
        TournamentMembershipEventPreference,
        TournamentMembershipLunch,
    ):
        db.query(model).filter(model.membership_id.in_(membership_ids)).delete(synchronize_session=False)

    db.query(TournamentMembership).filter(TournamentMembership.id.in_(membership_ids)).update(
        {TournamentMembership.onboarded_at: None}, synchronize_session=False
    )
    db.flush()
    # Those bulk updates bypassed the identity map, so loaded memberships still
    # hold their old onboarded_at — advance_onboarding_progress would read the
    # stale value and skip the write it should make.
    db.expire_all()


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def resolve_members(db: Session, tournament_id: int, email_prefix: str, enroll: bool, limit: int | None):
    """Every account whose email starts with the prefix, paired with its
    membership in this tournament — creating the membership when missing, so a
    freshly seeded environment doesn't come back empty."""
    from app.models.models import TournamentMembership, User

    users = (
        db.query(User)
        .filter(User.email.like(f"{email_prefix}%@%"))
        .order_by(User.id)
        .all()
    )
    if limit is not None:
        users = users[:limit]

    memberships_by_user = {
        m.user_id: m
        for m in db.query(TournamentMembership).filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id.in_([u.id for u in users] or [0]),
        )
    }

    pairs, created = [], 0
    for user in users:
        membership = memberships_by_user.get(user.id)
        if membership is None:
            if not enroll:
                continue
            membership = TournamentMembership(
                user_id=user.id, tournament_id=tournament_id, source="manual"
            )
            db.add(membership)
            created += 1
        pairs.append((user, membership))

    if created:
        db.flush()
    return pairs, created


def onboarding_forms(db: Session, tournament_id: int) -> list:
    from app.models.models import Form, TournamentForm

    return (
        db.query(Form)
        .join(TournamentForm, TournamentForm.form_id == Form.id)
        .filter(
            TournamentForm.tournament_id == tournament_id,
            TournamentForm.is_onboarding == True,  # noqa: E712 — SQLAlchemy column comparison
            Form.status == "published",
        )
        .order_by(TournamentForm.order)
        .all()
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.db.seed_members",
        description="Seed member profiles and onboarding responses for a tournament.",
    )
    parser.add_argument("-t", "--tournament", type=int, required=True, metavar="ID",
                        help="tournament id to seed")
    parser.add_argument("--email-prefix", default="test", metavar="PREFIX",
                        help="seed accounts whose email starts with this (default: test)")
    parser.add_argument("--limit", type=int, metavar="N",
                        help="only seed the first N matching accounts")
    parser.add_argument("--seed", type=int, default=0, metavar="N",
                        help="RNG seed - same value gives the same data (default: 0)")

    toggles = parser.add_argument_group("what to seed")
    toggles.add_argument("--onboarding", action=argparse.BooleanOptionalAction, default=True,
                         help="replay onboarding form submissions (default: on)")
    toggles.add_argument("--profiles", action=argparse.BooleanOptionalAction, default=True,
                         help="overwrite user profile fields (default: on)")
    toggles.add_argument("--experience", action=argparse.BooleanOptionalAction, default=True,
                         help="add prior competition/volunteer history (default: on)")
    toggles.add_argument("--enroll", action=argparse.BooleanOptionalAction, default=True,
                         help="create a membership for matching accounts that lack one (default: on)")

    shape = parser.add_argument_group("onboarding completion mix")
    shape.add_argument("--stop-every", type=int, default=5, metavar="N",
                       help="every Nth member stops after the first form; 0 for none (default: 5)")
    shape.add_argument("--unstarted-every", type=int, default=11, metavar="N",
                       help="every Nth member submits nothing; 0 for none (default: 11)")

    parser.add_argument("--dry-run", action="store_true",
                        help="roll back instead of committing")
    parser.add_argument("--force", action="store_true",
                        help="allow running outside development/preview")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    settings = get_settings()
    if settings.app_env not in ("development", "preview") and not args.force:
        print(f"refusing to seed with APP_ENV={settings.app_env!r} - pass --force to override")
        return 1

    from app.core.tournament.onboarding import advance_onboarding_progress
    from app.db.session import SessionLocal
    from app.models.models import Event, Tournament, University

    rng = random.Random(args.seed)
    db = SessionLocal()
    try:
        tournament = db.query(Tournament).filter(Tournament.id == args.tournament).first()
        if tournament is None:
            print(f"no tournament with id {args.tournament}")
            return 1

        pairs, created = resolve_members(db, tournament.id, args.email_prefix, args.enroll, args.limit)
        if not pairs:
            print(f"no accounts matching {args.email_prefix}*@* with a membership in {tournament.name!r}")
            return 1

        forms = onboarding_forms(db, tournament.id) if args.onboarding else []
        if args.onboarding and not forms:
            print(f"note: {tournament.name!r} has no published onboarding forms - skipping onboarding")

        print(f"tournament : {tournament.name} (id {tournament.id})")
        print(f"members    : {len(pairs)} matching {args.email_prefix}*@*"
              + (f" ({created} newly enrolled)" if created else ""))
        print(f"forms      : {[f.name for f in forms] or 'none'}")
        print(f"seeding    : " + ", ".join(
            name for name, on in (
                ("profiles", args.profiles),
                ("experience", args.experience), ("onboarding", bool(forms)),
            ) if on
        ) or "nothing")
        print()

        university_ids = [uid for (uid,) in db.query(University.id)]
        catalog_event_ids = [eid for (eid,) in db.query(Event.id)]
        # Dates live on the primary tracks, not the tournament — see
        # Tournament.dates. Profile years are anchored to the tournament's own
        # year so a member's graduation year makes sense relative to it.
        reference_year = (tournament.last_day or date.today()).year

        if forms:
            reset_onboarding(
                db,
                [f.id for f in forms],
                [u.id for u, _ in pairs],
                [m.id for _, m in pairs],
            )

        from app.api.routes.forms import _active_fields

        for index, (user, membership) in enumerate(pairs):
            if args.profiles:
                seed_profile(rng, user, university_ids, reference_year)
            if args.experience:
                seed_experience(rng, db, user, catalog_event_ids)

            membership.notes = rng.choice(MEMBERSHIP_NOTES)

            submitted = []
            if forms:
                # A fixed cadence rather than a dice roll, so the partway-through
                # states are guaranteed to exist instead of depending on the seed.
                unstarted = args.unstarted_every and index and index % args.unstarted_every == 0
                stops_early = args.stop_every and index and index % args.stop_every == 0
                to_submit = [] if unstarted else (forms[:1] if stops_early else forms)

                for form in to_submit:
                    active = _active_fields(db, form)
                    submit_response(db, form, membership, build_answers(rng, active), active)
                    submitted.append(form.name)

                advance_onboarding_progress(db, membership)

            print(f"  {user.email:<24} forms={len(submitted)} onboarded={membership.onboarded_at is not None}")

        if args.dry_run:
            db.rollback()
            print("\ndry run - rolled back")
        else:
            db.commit()
            print("\ndone")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
