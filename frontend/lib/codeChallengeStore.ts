import type { CodeChallenge } from "@/lib/api";

// The backend answers a new code request within a minute with 429 and keeps only the token's
// hash, so the tab keeps the challenge to reopen it after leaving the page or reloading.

export function saveChallenge(key: string, challenge: CodeChallenge | null): void {
  try {
    if (challenge) sessionStorage.setItem(key, JSON.stringify(challenge));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the 429 shows instead of reopening.
  }
}

/** The saved challenge, unless it has expired. */
export function loadOpenChallenge(key: string): CodeChallenge | null {
  try {
    const raw = sessionStorage.getItem(key);
    const challenge = raw ? (JSON.parse(raw) as CodeChallenge) : null;
    return challenge && new Date(challenge.expires_at).getTime() > Date.now() ? challenge : null;
  } catch {
    return null;
  }
}
