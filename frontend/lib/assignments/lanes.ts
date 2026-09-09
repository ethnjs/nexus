import { Assignment } from "@/lib/api";
import { Flag } from "@/lib/assignments/flags";

/**
 * Turning assignment rows into the bars a timeline draws.
 *
 * An assignment row holds exactly one shift, so a bar covering three shifts
 * is three rows. Grouping them back into bars is the same job on the
 * assignments board and in a member's own panel — the two differ only in what
 * a bar *is*: one person on an event there, one event on a person here. That
 * is the `keyOf` argument, and everything else is shared.
 */

export type AssignmentRole = Assignment["role"];

/** PersonRole.id is nullable — a role can be a free-text label with no
 *  catalog row behind it — so identity falls back to the label. Every role
 *  the board creates comes from the catalog (numeric id), so this only ever
 *  matters for reading existing assignments. */
export function roleKey(role: AssignmentRole): string {
  return role.id === null ? `label:${role.label}` : `id:${role.id}`;
}

export function sameRole(a: AssignmentRole, b: AssignmentRole): boolean {
  return roleKey(a) === roleKey(b);
}

/** The distinct roles a set of rows carries, in a stable order so the pill's
 *  summary doesn't reshuffle every time rows are rebuilt. */
export function rolesOf(rows: Assignment[]): AssignmentRole[] {
  const seen = new Map<string, AssignmentRole>();
  for (const row of rows) {
    const key = roleKey(row.role);
    if (!seen.has(key)) seen.set(key, row.role);
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The pill's own text. One role names itself; several would overflow a chip
 *  that may be one column wide, so the rest are a count the menu spells out. */
export function roleSummary(roles: AssignmentRole[]): string {
  if (roles.length === 0) return "Role";
  if (roles.length === 1) return roles[0].label;
  return `${roles[0].label} +${roles.length - 1}`;
}

export interface Lane {
  key: string;
  assignments: Assignment[];
  /** Indices into the shift list this bar covers. */
  covered: number[];
  /** Every distinct role the lane's rows carry. */
  roles: AssignmentRole[];
}

/**
 * Group rows into bars, split by whether they sit on one of `shiftIds`.
 *
 * `keyOf` is a bar's identity. The board keys by member — one person's bar
 * across an event's shifts — and the member panel keys by event, which is the
 * same picture read the other way round.
 */
export function buildLanes(
  rows: Assignment[],
  shiftIds: number[],
  keyOf: (assignment: Assignment) => string,
): { lanes: Lane[]; unpinned: Lane[] } {
  const pinned = new Map<string, Assignment[]>();
  const loose = new Map<string, Assignment[]>();

  for (const assignment of rows) {
    const index = assignment.shift ? shiftIds.indexOf(assignment.shift.id) : -1;
    const into = index === -1 ? loose : pinned;
    const key = keyOf(assignment);
    const list = into.get(key);
    if (list) list.push(assignment);
    else into.set(key, [assignment]);
  }

  const toLanes = (grouped: Map<string, Assignment[]>): Lane[] =>
    [...grouped.entries()].map(([key, group]) => ({
      key,
      assignments: group,
      // Distinct, because the same shift appears once per role.
      covered: [...new Set(
        group.map((row) => (row.shift ? shiftIds.indexOf(row.shift.id) : -1)),
      )].filter((i) => i >= 0),
      roles: rolesOf(group),
    }));

  return { lanes: toLanes(pinned), unpinned: toLanes(loose) };
}

/** One message per distinct warning. A lane is one assignment row per shift,
 *  so flagging each row repeats "not available for Sun afternoon" once per
 *  shift the bar covers — which is what made the tooltip a paragraph. */
export function laneFlags(lane: Lane, flagsFor: (a: Assignment) => Flag[]): Flag[] {
  const seen = new Map<string, Flag>();
  for (const flag of lane.assignments.flatMap(flagsFor)) {
    if (!seen.has(flag.detail)) seen.set(flag.detail, flag);
  }
  return [...seen.values()];
}
