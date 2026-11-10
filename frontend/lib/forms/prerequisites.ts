import type { RolePrerequisite, TournamentFormPrerequisites } from "@/lib/api";

function list(labels: string[]): string {
  return labels.join(", ");
}

function conditionText(condition: RolePrerequisite, roleLabel: (id: number) => string): string {
  const labels = condition.ids.map(roleLabel);
  if (labels.length === 1)
    return condition.inverse ? `don't have ${labels[0]}` : `have ${labels[0]}`;
  if (condition.match === "all") {
    return condition.inverse ? `don't have all of ${list(labels)}` : `have all of ${list(labels)}`;
  }
  return condition.inverse ? `have none of ${list(labels)}` : `have any of ${list(labels)}`;
}

/** "Members who have Runner and don't have Event Supervisor", or null when
 *  the form has no conditions. */
export function prerequisiteSummary(
  prerequisites: TournamentFormPrerequisites | null,
  roleLabel: (id: number) => string,
): string | null {
  const conditions = prerequisites?.roles ?? [];
  if (conditions.length === 0) return null;
  return `Members who ${conditions.map((c) => conditionText(c, roleLabel)).join(" and ")}`;
}
