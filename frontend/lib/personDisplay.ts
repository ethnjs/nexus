import { MembershipSlim, UserSlim } from "@/lib/api";

// Shared shape for anything the backend resolves to "membership if they have
// one in this tournament, bare user otherwise" — Invite.creator and
// AuditLogEntry.actor both use it.
export type PersonRef = MembershipSlim | UserSlim;

export function personUser(ref: PersonRef): UserSlim {
  return "user" in ref ? ref.user : ref;
}

export function personName(ref: PersonRef): string {
  const user = personUser(ref);
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
}

// Roles are only present when ref is a MembershipSlim (they hold a
// membership in this tournament) — null for the bare-UserSlim fallback.
export function personRoles(ref: PersonRef) {
  return "roles" in ref ? ref.roles : null;
}
