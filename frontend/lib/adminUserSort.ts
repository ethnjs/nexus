import type { SortFieldOption } from "@/components/ui/SortModal";
import type { AdminUserFull } from "@/lib/api";
import { userAffiliation, yearLevelOrder } from "@/lib/personDisplay";
import type { SortRule, SortValue } from "@/lib/sorting";

export type AdminUserSortField =
  | "name"
  | "joined"
  | "affiliation"
  | "year_level"
  | "role"
  | "status";

/** Direction labels say what the order is — see EVENT_SORT_OPTIONS. */
export const ADMIN_USER_SORT_OPTIONS: SortFieldOption[] = [
  { value: "name", label: "Name", ascLabel: "A → Z", descLabel: "Z → A" },
  { value: "joined", label: "Joined", ascLabel: "Oldest first", descLabel: "Newest first" },
  { value: "affiliation", label: "Affiliation", ascLabel: "A → Z", descLabel: "Z → A" },
  {
    value: "year_level",
    label: "Year level",
    ascLabel: "1st year first",
    descLabel: "Not a student first",
  },
  { value: "role", label: "Role", ascLabel: "Admins first", descLabel: "Users first" },
  { value: "status", label: "Status", ascLabel: "Active first", descLabel: "Locked first" },
];

/** By last name — the order the server sends the list in. */
export const DEFAULT_ADMIN_USER_SORT: SortRule<AdminUserSortField>[] = [
  { field: "name", direction: "asc" },
];

/** What the chain falls back to, and the sentence the modal prints. */
export const ADMIN_USER_SORT_TIEBREAK = "last name, then first name";

const ROLE_ORDER = { admin: 0, user: 1 };
// Active through to the account an admin shut.
const STATUS_ORDER = { active: 0, invited: 1, deactivated: 2, locked: 3 };

export function adminUserSortValue(user: AdminUserFull, field: AdminUserSortField): SortValue {
  switch (field) {
    // Last name first, so "A → Z" reads down a roster; no name at all falls
    // back to the email the Name column shows instead.
    case "name":
      return [user.last_name, user.first_name].filter(Boolean).join(" ") || user.email;
    case "joined":
      return new Date(user.created_at).getTime();
    // The short form, so the order matches what the column shows.
    case "affiliation":
      return userAffiliation(user, true);
    case "year_level":
      return yearLevelOrder(user);
    case "role":
      return ROLE_ORDER[user.role];
    case "status":
      return STATUS_ORDER[user.status];
  }
}

/** The hidden tail every chain ends with, so the order is total. */
export function adminUserSortTiebreak(a: AdminUserFull, b: AdminUserFull): number {
  const byName = (adminUserSortValue(a, "name") as string).localeCompare(
    adminUserSortValue(b, "name") as string,
    undefined,
    { numeric: true, sensitivity: "base" },
  );
  return byName !== 0 ? byName : a.id - b.id;
}
