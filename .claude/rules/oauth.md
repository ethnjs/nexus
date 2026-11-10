---
paths:
  - "backend/app/api/routes/oauth.py"
  - "backend/app/core/oauth.py"
  - "backend/tests/api/test_oauth_google.py"
  - "frontend/app/(auth)/sign-in/**"
  - "frontend/components/auth/GoogleSignInButton.tsx"
---

# OAuth sign-in

Read `backend/docs/oauth-identities.md` before changing Google sign-in or account linking. Update it in the same PR when behavior changes.

- A Google sign-in never creates a session. It starts the same `sign_in` code challenge as password sign-in and hands it to `/sign-in` in the URL fragment, never the query string.
- Never auto-link a provider account to an existing user by email.
