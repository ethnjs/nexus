import { Badge } from "@/components/ui/Badge";
import { ROLE, USER_STATUS } from "@/lib/api";

/**
 * Colour per account status. Shared so the users table's Status column and
 * every badge strip agree — a locked account has to look the same wherever
 * it's named.
 */
export const STATUS_VARIANT: Record<USER_STATUS, "confirmed" | "pending" | "removed" | "declined"> = {
  active:      "confirmed",
  invited:     "pending",
  deactivated: "removed",
  locked:      "declined",
};

/**
 * Role, status and email verification as one strip — the account state an
 * admin needs beside a name. Rendered into ProfileHeader's `badges` slot by
 * both the admin panel and /profile/[id].
 *
 * Admin-only by convention, enforced by the callers: every one of these is
 * account-internal, and /profile/[id] shows the same header to any signed-in
 * viewer.
 */
export function AccountBadges({ user }: {
  user: { role: ROLE; status: USER_STATUS; email_verified: boolean };
}) {
  return (
    <>
      <Badge variant={user.role === "admin" ? "admin" : "default"}>
        {user.role === "admin" ? "Admin" : "User"}
      </Badge>
      <Badge variant={STATUS_VARIANT[user.status]}>{user.status}</Badge>
      <Badge variant={user.email_verified ? "confirmed" : "warning"}>
        {user.email_verified ? "Email verified" : "Email unverified"}
      </Badge>
    </>
  );
}
