from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.core.auth import hash_password
from app.core.filter_conditions import validate_filter
from app.core.tournament.display_config import KNOWN_SORT_DIRECTIONS
from app.models.models import (
    Tournament,
    TournamentEvent,
    TournamentMembership,
    TournamentTrackAssignment,
    User,
)
from app.schemas.tournament.display_config import DisplayConfigSurface


def check_if_email_exists(db: Session, email: str, exclude_user_id: int | None = None):
    query = db.query(User).filter(User.email == email.lower())
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    existing = query.first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )


def find_user_by_id(db: Session, id: int) -> User:
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def require_not_last_admin(db: Session, user: User) -> None:
    """Refuses to take the platform's only admin out of service.

    Belongs on the *self-service* routes, not the admin ones. An admin acting
    on somebody else is still an admin afterwards, so once the admin routes
    refuse to act on the caller themselves they can never reach zero admins.
    Self-delete and self-deactivate are the only paths that can, and both are
    one-way: nothing outside an admin can restore an account.
    """
    if user.role != "admin":
        return
    if db.query(User).filter(User.role == "admin").count() <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The platform must keep at least one admin account",
        )


def create_user(
    db: Session,
    email: str,
    first_name: str | None = None,
    last_name: str | None = None,
    role: str = "user",
    phone: str | None = None,
    password: str | None = None,
    status: str = "active",
    hashed_password: str | None = None,
) -> User:
    user = User(
        email=email.lower(),
        phone=phone,
        hashed_password=hash_password(password) if password else hashed_password,
        first_name=first_name,
        last_name=last_name,
        role=role,
        status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# The surfaces User.display_config holds, each with its filter keys and sort
# fields. Admin-only surfaces are refused to everyone else on write.
ADMIN_USERS = "admin_users"
USER_SURFACES: dict[str, tuple[frozenset[str], frozenset[str]]] = {
    ADMIN_USERS: (
        frozenset({"role", "status", "verified", "affiliation", "year_level", "tournament"}),
        frozenset({"name", "joined", "affiliation", "year_level", "role", "status"}),
    ),
}
ADMIN_ONLY_SURFACES = frozenset({ADMIN_USERS})


def validate_user_display_config(user: User, payload: dict[str, DisplayConfigSurface]) -> None:
    for surface, config in payload.items():
        if surface not in USER_SURFACES or (
            surface in ADMIN_ONLY_SURFACES and user.role != "admin"
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unknown surface '{surface}'",
            )
        filter_keys, sort_fields = USER_SURFACES[surface]
        for key in config.filters or {}:
            if key not in filter_keys:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Unknown filter '{key}'",
                )
        if config.filter is not None:
            validate_filter(config.filter, filter_keys)
        for rule in ([config.sort] if config.sort else []) + (config.sorts or []):
            if rule.field not in sort_fields:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Unknown sort field '{rule.field}'",
                )
            if rule.direction not in KNOWN_SORT_DIRECTIONS:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Unknown sort direction '{rule.direction}'",
                )


def tournament_membership_loads() -> tuple:
    """Loader options, relative to a TournamentMembership, for what
    UserTournamentMembershipResponse reads."""
    return (
        selectinload(TournamentMembership.tournament).selectinload(Tournament.tracks),
        selectinload(TournamentMembership.track_assignments)
        .joinedload(TournamentTrackAssignment.tournament_event)
        .joinedload(TournamentEvent.event),
    )
