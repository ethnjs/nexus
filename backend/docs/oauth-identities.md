# OAuth identities

Google sign-in is an OIDC Authorization Code flow with PKCE and a nonce. FastAPI (Authlib) is the client. The browser only ever holds the `access_token` login cookie and, for the few seconds of the redirect, the signed `oauth_state` cookie.

`request.session` is that handshake cookie. It is not a login session and cannot be revoked; rotating `OAUTH_STATE_SECRET` invalidates any in-flight attempt. Login stays on `UserSession` and can be revoked as before.

## Sign-in and sign-up are one route

`GET /auth/oauth/google/callback/` resolves in this order:

1. An `oauth_identities` row for this Google `sub` is that user.
2. No identity, but some user already has this email: redirect with `google_account_exists`. Do not create a second account and do not auto-link. Linking only happens from a signed-in session (Settings), which is what Auth.js and Firebase do, because an OAuth email claim is not proof that this person owns the existing account.
3. Neither, and Google says it verified the email: create the user and the identity in one transaction. An unverified Google email redirects with `google_email_unverified` and creates nothing. Name is prefilled; onboarding still starts on the name step because phone and the rest are missing.

Identities are keyed on `sub`, not email. Google emails can change.

## The emailed code

A Google sign-in creates no session. Like a password sign-in, it starts a `sign_in` challenge (`start_challenge` in `core/email_codes.py`), emails the code to the account address, and redirects to `/sign-in` with the challenge in the URL fragment: `email`, `challenge_token`, `expires_in`, and `resend_in`. The fragment never reaches a server, and the sign-in page saves the challenge, clears the fragment, and shows the code step. `POST /auth/code/verify/` then creates the session.

A new account starts with `email_verified` false. Entering the code verifies it; Google's claim only decides whether the account may be created.

A second attempt within a minute gets 429 from `start_challenge`, so the callback sends only `email`, and the page reopens the challenge this tab saved, or says to wait a minute.

While `LOGIN_CODES_REQUIRED` is false, the callback signs in directly, as password sign-in does.

## Link and unlink

`intent=link` requires the current `access_token` session, and the callback checks it is still the same user. The Google email does not have to match `users.email`. Linking takes no code: the session already exists, and a linked Google account still can't sign in without the code sent to the account email.

Unlink is refused when `hashed_password` is null, since it would lock the account out. Google-only accounts set a password at `POST /auth/password/set/`, which requires a code entered in the last 10 minutes (`require_recent_code`), because there's no current password to confirm.

## Redirect URI

The redirect URI is `FRONTEND_URL` plus `api/proxy/auth/oauth/google/callback` (`google_redirect_uri()` in `core/oauth.py`), and Google's console must list it exactly. It goes through the Next.js proxy so `oauth_state` and the session cookie stay first-party. It has no trailing slash, because Next.js strips one before the route handler runs and the proxy adds it back toward the backend.

`oauth_state` is `SameSite=Lax`. `Strict` would drop the cookie on the cross-site return from Google.

## Adding a provider

`oauth_provider` is a native Postgres enum. A new value is a hand-written migration (`ALTER TYPE oauth_provider ADD VALUE 'discord'`), not autogenerate. `email_at_provider` is nullable for providers with no email, such as Discord. Authlib's HTTP client is `httpx2`, a direct dependency in `pyproject.toml` because Authlib does not declare it.
