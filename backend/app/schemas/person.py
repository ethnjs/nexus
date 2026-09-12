"""The shape every "who did this" reference takes — a join code's creator, an
audit log's actor, a form's author.

Deliberately imports nothing from app.schemas.tournament.* or app.core.*: it
is referenced from membership, join-code, audit and form schemas alike, and
staying at the bottom of the import graph is what keeps that from cycling.
"""
from __future__ import annotations

from pydantic import BaseModel, model_validator


class PersonRoleRead(BaseModel):
    """A role, reduced to what identifies it.

    Not RoleRead: that carries `permissions` and `rank`, which are the
    tournament's authorization model and have no business riding along on an
    "invited by" line. Keeping a separate type means widening RoleRead can't
    silently widen this.
    """
    # None for a chapter role, which is a plain string on the membership
    # rather than a row of its own.
    id: int | None = None
    label: str


class PersonNameRef(BaseModel):
    """Who someone is, with no claim about what they do here.

    Split out of PersonRefResponse for readers that name a person in a context
    where their role is already established by the surrounding row — an event
    assignment names its own role, so carrying the member's whole role list
    beside it is noise.

    It is a separate type rather than PersonRefResponse-with-roles-nulled
    because `roles: null` is not nothing: it specifically means "holds no
    membership here", which on an assignment would be false.
    """
    # The *user* id, not the membership's — audit-log filtering keys off it,
    # and a field named `id` next to `membership_id` invites picking wrong.
    user_id: int
    # None when they hold no membership in this tournament/chapter, e.g. a
    # site admin acting without joining.
    membership_id: int | None = None
    first_name: str | None = None
    last_name: str | None = None

    @classmethod
    def from_membership(cls, membership) -> "PersonNameRef":
        """Built from a TournamentMembership, whose name lives one hop away on
        the joined user."""
        return cls(
            user_id=membership.user_id,
            membership_id=membership.id,
            first_name=membership.user.first_name,
            last_name=membership.user.last_name,
        )


class PersonRefResponse(PersonNameRef):
    """A person plus what they do here — for the purpose of crediting an
    action.

    This replaced a `MembershipSlim | UserSlim` union that embedded the whole
    roster row — email, phone, pronouns, age flags, lunch choices and custom
    form answers — everywhere a creator or actor appeared. One type rather
    than a union because narrowing was the union's only purpose: `roles` now
    carries the "no membership here" signal the bare-user branch used to.
    """
    # Three distinct states, all meaningful:
    #   null     no membership here at all
    #   []       a member holding no roles
    #   absent   the viewer isn't entitled to them (see get_membership, where
    #            a self-viewer gets the creator's name and nothing more)
    roles: list[PersonRoleRead] | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_bare_user(cls, data):
        """Accept a User ORM object, mapping it to a reference with no roles.

        Some responses validate straight off a relationship that holds a User
        — JoinCode.creator is one — and that path knows nothing of the
        tournament, so it can't resolve roles. Callers that can (see
        resolve_person_refs) overwrite the field afterwards with the full
        reference; this keeps the ones that can't from failing validation.
        """
        if isinstance(data, dict) or isinstance(data, cls):
            return data
        user_id = getattr(data, "id", None)
        if user_id is None or hasattr(data, "user_id"):
            return data
        return {
            "user_id": user_id,
            "first_name": getattr(data, "first_name", None),
            "last_name": getattr(data, "last_name", None),
        }
