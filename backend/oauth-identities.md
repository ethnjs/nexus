# OAuth identities

Google sign-in is an OIDC Authorization Code flow with PKCE and a nonce. FastAPI (Authlib) is the client. The browser only ever holds the `access_token` login cookie and, for the few seconds of the redirect, the signed `oauth_state` cookie.

`request.session` is that handshake cookie. It is not a login session and cannot be revoked; rotating `OAUTH_STATE_SECRET` invalidates any in-flight attempt. Login stays on `UserSession` and can be revoked as before.

## Sign-in and sign-up are one route

`GET /auth/oauth/google/callback/` resolves in this order:

1. An `oauth_identities` row for this Google `sub` logs that user in.
2. No identity, but some user already has this email: redirect with `google_account_exists`. Do not create a second account and do not auto-link. Linking only happens from a signed-in session (Settings), which is what Auth.js and Firebase do, because an OAuth email claim is not proof that this person owns the existing account.
3. Neither: create the user and the identity in one transaction. `email_verified` is Google's claim. Name is prefilled; onboarding still starts on the name step because phone and the rest are missing.

Identities are keyed on `sub`, not email. Google emails can change.

## Link and unlink

`intent=link` requires the current `access_token` session, and the callback checks it is still the same user. The Google email does not have to match `users.email`.

Unlink is refused when `hashed_password` is null — it would lock the account out. Google-only accounts set a password at `POST /auth/password/set/`.

## Redirect URI

`GOOGLE_OAUTH_REDIRECT_URI` must match Google's console exactly. The backend route keeps its trailing slash (`http://localhost:8001/auth/oauth/google/callback/`). The Next.js proxy paths do not, because Next.js strips a trailing slash before the route handler runs and the proxy adds it back toward the backend.

`oauth_state` is `SameSite=Lax`. `Strict` would drop the cookie on the cross-site return from Google.

## Adding a provider

`oauth_provider` is a native Postgres enum. A new value is a hand-written migration (`ALTER TYPE oauth_provider ADD VALUE 'discord'`), not autogenerate. Discord will not have an email; `email_at_provider` is already nullable. `authlib` 1.8's HTTP client is `httpx2`, pinned next to it in `requirements.txt` because Authlib does not declare that dependency.
