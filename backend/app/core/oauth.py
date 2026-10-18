"""Google OIDC sign-in, and linking Google or Discord to a signed-in account.

`request.session` (SessionMiddleware) holds only the in-flight handshake —
state, PKCE, nonce, intent. It is not the login session. Login is still the
`access_token` cookie backed by a `UserSession` row.

Sign-in and sign-up share one resolution order:
1. An identity row for this provider account id logs in.
2. No identity, but a user already has this email: reject. Never auto-link.
3. Neither: create the user and the identity together.
"""

from urllib.parse import urlencode

from authlib.integrations.starlette_client import OAuth
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.models import OAuthIdentity, OAuthProvider, User

_oauth = None


class AccountExists(Exception):
    """A password (or otherwise) account already uses this email."""


class AccountInactive(Exception):
    """The matched account is not status='active'."""


class EmailUnverified(Exception):
    """Google hasn't verified the email, so it can't claim a new account."""


class IdentityLinkError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def is_google_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.google_oauth_client_id
        and settings.google_oauth_client_secret
        and settings.google_oauth_redirect_uri
    )


def is_discord_link_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.discord_application_id
        and settings.discord_client_secret
        and settings.discord_link_redirect_uri
    )


def get_google_oauth():
    """Lazily registered so tests (and a missing client) don't build it at import."""
    global _oauth
    if _oauth is None:
        settings = get_settings()
        _oauth = OAuth()
        _oauth.register(
            name="google",
            client_id=settings.google_oauth_client_id,
            client_secret=settings.google_oauth_client_secret,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={
                "scope": "openid email profile",
                "code_challenge_method": "S256",
            },
        )
    return _oauth


def safe_redirect_path(path: str | None) -> str | None:
    """Same rule as frontend `safeRedirectPath`: a single-slash relative path."""
    if not path:
        return None
    if not path.startswith("/") or path.startswith("//") or "://" in path:
        return None
    return path


def frontend_redirect(path: str) -> str:
    # frontend_url is stored with a trailing slash.
    base = get_settings().frontend_url.rstrip("/")
    return base + path


def _name(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()[:100]
    return value or None


def email_and_sub(claims: dict) -> tuple[str, str]:
    email = claims.get("email")
    sub = claims.get("sub")
    if not isinstance(email, str) or "@" not in email or len(email) > 255:
        raise ValueError("Google account has no usable email")
    if not isinstance(sub, str) or not sub or len(sub) > 255:
        raise ValueError("Google account has no usable id")
    return email.lower(), sub


def _find_identity(db: Session, provider: OAuthProvider, account_id: str) -> OAuthIdentity | None:
    return (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.provider == provider,
            OAuthIdentity.provider_account_id == account_id,
        )
        .first()
    )


def resolve_google_login(db: Session, claims: dict) -> tuple[User, bool]:
    """Returns (user, created). Raises AccountExists, AccountInactive, or EmailUnverified."""
    email, sub = email_and_sub(claims)
    identity = _find_identity(db, OAuthProvider.google, sub)
    if identity is not None:
        user = identity.user
        if user.status != "active":
            raise AccountInactive()
        if identity.email_at_provider != email:
            identity.email_at_provider = email
            db.commit()
        return user, False

    # A Google account can carry an address its owner never proved. Creating a NEXUS account for
    # it would squat the address, and the real owner's password reset would hand them an account
    # the squatter can still sign in to.
    if claims.get("email_verified") is not True:
        raise EmailUnverified()
    existing = db.query(User).filter(User.email == email).first()
    if existing is not None:
        raise AccountExists()

    # create_user() commits on its own, so a lost race on the identity insert
    # would leave a user with no way to sign in. Both rows commit together.
    user = User(
        email=email,
        first_name=_name(claims.get("given_name")),
        last_name=_name(claims.get("family_name")),
        hashed_password=None,
        email_verified=True,
        role="user",
        status="active",
    )
    db.add(user)
    try:
        db.flush()
        db.add(
            OAuthIdentity(
                user_id=user.id,
                provider=OAuthProvider.google,
                provider_account_id=sub,
                email_at_provider=email,
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.query(User).filter(User.email == email).first() is not None:
            raise AccountExists() from None
        raise
    db.refresh(user)
    return user, True


def link_identity(
    db: Session,
    user: User,
    provider: OAuthProvider,
    account_id: str,
    *,
    email: str | None = None,
    username: str | None = None,
) -> OAuthIdentity:
    """Attach a provider account to an already-signed-in user, and commit. No email match.

    Raises IdentityLinkError with `<provider>_link_exists` when the user already has an
    account for this provider, or `<provider>_already_linked` when another user has this one.
    """
    existing = _find_identity(db, provider, account_id)
    if existing is not None:
        same_user = existing.user_id == user.id
        raise IdentityLinkError(f"{provider}_{'link_exists' if same_user else 'already_linked'}")

    owned = (
        db.query(OAuthIdentity)
        .filter(OAuthIdentity.user_id == user.id, OAuthIdentity.provider == provider)
        .first()
    )
    if owned is not None:
        raise IdentityLinkError(f"{provider}_link_exists")

    row = OAuthIdentity(
        user_id=user.id,
        provider=provider,
        provider_account_id=account_id,
        email_at_provider=email,
        username_at_provider=username,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise IdentityLinkError(f"{provider}_already_linked") from None
    db.refresh(row)
    return row


def with_query(path: str, **params: str) -> str:
    return path + ("&" if "?" in path else "?") + urlencode(params)


def with_redirect(path: str, redirect: str | None) -> str:
    if not redirect:
        return path
    return with_query(path, redirect=redirect)
