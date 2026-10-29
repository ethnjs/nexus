import type { PersonRef, UserFull, UserSlim } from "@/lib/api";

// How the backend credits an action — a join code's creator, an audit log's
// actor, a form's author. It carries a name and roles and nothing else: the
// old shape embedded the whole roster row (email, phone, age flags, lunch
// choices) on every one of those references. See PersonRefResponse.

export function personName(ref: PersonRef): string {
  if (ref.user_id === null) return "Deleted user";
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

type EducationFields = Pick<UserFull, "student_status" | "university" | "year_level" | "employer">;

// The profile's year dropdown tops out at 5, which stands for fifth or later.
export const YEAR_LEVEL_OPTIONS = [
  { value: "1", label: "1st Year" },
  { value: "2", label: "2nd Year" },
  { value: "3", label: "3rd Year" },
  { value: "4", label: "4th Year" },
  { value: "5", label: "5th Year+" },
];

export function formatYearLevel(year: number | null): string | null {
  if (year === null) return null;
  return YEAR_LEVEL_OPTIONS.find((o) => o.value === String(Math.min(year, 5)))?.label ?? null;
}

/** The school for a student, the employer otherwise — never both. `short`
 *  picks the university's abbreviation, for a table cell. */
export function userAffiliation(user: EducationFields, short = false): string | null {
  if (user.student_status === null) return null;
  if (user.student_status === "Non-Student") return user.employer || null;
  if (!user.university) return null;
  return (short && user.university.abbreviation) || user.university.name;
}

export function userYearLevel(user: EducationFields): string | null {
  switch (user.student_status) {
    case "Undergraduate":
      return formatYearLevel(user.year_level);
    case "Graduate":
      return "Graduate";
    case "Non-Student":
      return "Not a student";
    default:
      return null;
  }
}
