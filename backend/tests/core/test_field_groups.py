"""Unit tests for the `fields` query param's group definitions.

No database and no routes — this covers the mechanism itself. The routes
that consume it are exercised in tests/api/tournament/test_memberships.py.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.tournament.field_groups import (
    ALL_GROUPS, ALWAYS_KEYS, ALWAYS_USER_KEYS, GROUPS,
    dump_exclude, loader_options, parse_fields, wants,
)
from app.schemas.tournament.membership import (
    MembershipFullResponse, MembershipMeResponse,
)
from app.schemas.user import UserFullResponse


# ---------------------------------------------------------------------------
# The invariant that keeps this honest: every field on either response model
# is either always-present or owned by exactly one group. A new schema field
# that nobody classified fails here rather than silently becoming
# unrequestable (or, worse, leaking into a response that excluded its group).
# ---------------------------------------------------------------------------

def test_every_response_field_is_always_present_or_in_exactly_one_group():
    grouped: dict[str, list[str]] = {}
    for name, group in GROUPS.items():
        for key in group.keys:
            grouped.setdefault(key, []).append(name)

    for model in (MembershipFullResponse, MembershipMeResponse):
        for key in model.model_fields:
            owners = grouped.get(key, [])
            if key in ALWAYS_KEYS:
                assert owners == [], f"{model.__name__}.{key} is always-present but also in {owners}"
            else:
                assert len(owners) == 1, f"{model.__name__}.{key} is owned by {owners}, expected exactly one group"


def test_every_user_field_is_always_present_or_in_exactly_one_group():
    grouped: dict[str, list[str]] = {}
    for name, group in GROUPS.items():
        for key in group.user_keys:
            grouped.setdefault(key, []).append(name)

    for key in UserFullResponse.model_fields:
        owners = grouped.get(key, [])
        if key in ALWAYS_USER_KEYS:
            assert owners == [], f"user.{key} is always-present but also in {owners}"
        else:
            assert len(owners) == 1, f"user.{key} is owned by {owners}, expected exactly one group"


def test_date_of_birth_is_not_requestable_at_all():
    """DOB is never serialized to anyone — only the derived is_over_18/21
    flags are, and those are consent-gated on top. It must not appear as a
    user key on any group, or `fields=profile` would expose it."""
    for group in GROUPS.values():
        assert "date_of_birth" not in group.user_keys
    assert "date_of_birth" not in UserFullResponse.model_fields


# ---------------------------------------------------------------------------
# parse_fields
# ---------------------------------------------------------------------------

def test_absent_param_means_everything():
    """A caller with no opinion gets the whole row, not an empty one."""
    assert parse_fields(None) is None
    assert wants(None, "profile") is True


def test_empty_string_means_identity_only():
    """Distinct from absent: /join reads nothing but membership_id, and says
    so by sending an empty fields."""
    assert parse_fields("") == frozenset()
    assert wants(frozenset(), "profile") is False


def test_parses_and_deduplicates_names():
    assert parse_fields("contact,roles") == frozenset({"contact", "roles"})
    assert parse_fields(" contact , roles ") == frozenset({"contact", "roles"})
    assert parse_fields("roles,roles") == frozenset({"roles"})
    # Trailing/doubled separators are sloppy, not wrong.
    assert parse_fields("roles,,") == frozenset({"roles"})


def test_unknown_group_is_rejected_with_the_valid_list():
    """A typo must fail the request, not quietly drop a section — that would
    look identical to the member having no data."""
    with pytest.raises(HTTPException) as exc:
        parse_fields("contact,rolez")
    assert exc.value.status_code == 422
    assert "rolez" in exc.value.detail
    # The error carries the vocabulary, so a client never has to guess.
    for name in ALL_GROUPS:
        assert name in exc.value.detail


def test_unknown_group_error_names_only_the_unknown_ones():
    with pytest.raises(HTTPException) as exc:
        parse_fields("nope,contact")
    assert "Unknown field group(s): nope." in exc.value.detail


# ---------------------------------------------------------------------------
# dump_exclude
# ---------------------------------------------------------------------------

def test_no_narrowing_excludes_nothing():
    assert dump_exclude(None) is None
    assert dump_exclude(ALL_GROUPS) is None


def test_excludes_every_unrequested_group():
    exclude = dump_exclude(frozenset({"roles"}))
    assert exclude["notes"] is True
    assert exclude["track_statuses"] is True
    assert exclude["lunch"] is True
    assert "roles" not in exclude


def test_user_keys_are_pruned_inside_the_user_object():
    """The user object itself always serializes — contact and profile prune
    keys within it rather than removing it."""
    exclude = dump_exclude(frozenset({"contact"}))
    assert "user" not in {k for k, v in exclude.items() if v is True}
    assert "email" not in exclude["user"]
    assert "phone" not in exclude["user"]
    # profile wasn't asked for, so its keys go.
    assert "shirt_size" in exclude["user"]
    assert "volunteer_experience" in exclude["user"]
    # ...but identity survives regardless.
    for key in ALWAYS_USER_KEYS:
        assert key not in exclude["user"]


def test_unrequested_group_is_absent_from_the_dump_not_null():
    """The whole point of the encoding: a missing key means "you didn't ask",
    so null and [] keep their ordinary meanings."""
    row = MembershipFullResponse(
        id=1, tournament_id=1, source="manual",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
        user={
            "id": 1, "first_name": "Ana", "last_name": "Diaz", "email": "a@x.com",
            "phone": None, "pronouns": None,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
            "student_status": None, "university": None, "major": None,
            "year_level": None, "graduation_year": None, "employer": None,
            "has_competition_experience": None, "has_volunteer_experience": None,
            "competition_experience": [], "volunteer_experience": [],
            "shirt_size": None, "dietary_restriction": None,
        },
    )
    data = row.model_dump(mode="json", exclude=dump_exclude(frozenset({"contact"})))

    assert "notes" not in data
    assert "lunch" not in data
    assert "track_statuses" not in data
    assert data["user"]["email"] == "a@x.com"
    assert "shirt_size" not in data["user"]
    # Identity is not a group, so it is there without being asked for.
    assert data["id"] == 1
    assert data["user"]["first_name"] == "Ana"


def test_one_exclude_set_serves_both_response_models():
    """The Me response has no notes/source/user, and excluding a field a
    model doesn't declare is a no-op — which is what lets the same exclude
    dict be reused across both audiences."""
    me = MembershipMeResponse(id=7, is_owner=False, permissions=["manage_members"])
    data = me.model_dump(mode="json", exclude=dump_exclude(frozenset({"roles"})))

    assert data["id"] == 7
    assert data["permissions"] == ["manage_members"]
    assert data["roles"] == []
    assert "lunch" not in data
    assert "custom_responses" not in data


# ---------------------------------------------------------------------------
# loader_options
# ---------------------------------------------------------------------------

def test_loader_options_compile_against_a_real_query(db: Session):
    """Guards the failure this module exists to prevent: two strategies for
    one ORM path (a bare joinedload(user) plus a selectinload chained off it)
    raise InvalidRequestError only at compile time, not when the option is
    built."""
    from sqlalchemy.orm import joinedload
    from app.models.models import TournamentMembership

    for requested in (None, frozenset(), frozenset({"profile"}), frozenset({"contact", "roles"}), ALL_GROUPS):
        query = (
            db.query(TournamentMembership)
            .options(
                joinedload(TournamentMembership.user),
                *loader_options(requested),
            )
        )
        # .all() is what forces the compile; an empty table is fine.
        query.limit(0).all()


def test_unwanted_relationships_are_noloaded_not_lazy():
    """A relationship left on its default strategy would be lazy-loaded by
    pydantic during validation — one query per row for data the dump is
    about to exclude."""
    from sqlalchemy.orm.strategy_options import _AbstractLoad

    options = loader_options(frozenset({"roles"}))
    assert options, "narrowing should always produce loader options"
    assert all(isinstance(opt, _AbstractLoad) for opt in options)


def test_built_groups_are_the_ones_needing_a_builder_pass():
    """`built` means the raw ORM rows aren't the final value. Those builders
    mostly still read the relationship, so this is not the same as "has no
    relationship" — custom is the only group with neither."""
    built = {name for name, group in GROUPS.items() if group.built}
    assert built == {"lunch", "event_prefs", "custom"}
    assert GROUPS["custom"].relationships == ()
    # The other two need their rows loaded for the builder to read.
    assert GROUPS["lunch"].relationships == ("lunch_selections",)
    assert GROUPS["event_prefs"].relationships == ("event_preferences",)
