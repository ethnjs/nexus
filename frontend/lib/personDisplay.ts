import { PersonRef, UserSlim } from "@/lib/api";

// How the backend credits an action — a join code's creator, an audit log's
// actor, a form's author. It carries a name and roles and nothing else: the
// old shape embedded the whole roster row (email, phone, age flags, lunch
// choices) on every one of those references. See PersonRefResponse.

export function personName(ref: PersonRef): string {
  const name = `${ref.first_name ?? ""} ${ref.last_name ?? ""}`.trim();
  // Defensive only: anyone who can appear as a reference has acted in the
  // app, and the profile flow collects a name before that. There's no email
  // to fall back to any more, which is the point.
  return name || "Unknown user";
}

// null and undefined both mean "don't render role chips", for different
// reasons — no membership here, versus a viewer not entitled to them.
export function personRoles(ref: PersonRef) {
  return ref.roles ?? null;
}

// For a real user object rather than a reference — the callers that hold a
// full membership or user keep the email fallback, since they have one.
export function userName(user: UserSlim): string {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
}
