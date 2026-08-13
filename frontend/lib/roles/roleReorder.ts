import { Role } from "@/lib/api";

export type DropZoneKind = "above" | "below" | "join";

export const RANK_STEP = 10;

// A role the user has added in the editor but hasn't saved yet lives in the
// same list as real roles so drag/reorder/nav-rail code needs no special case —
// it's told apart only by a negative synthetic id, which no backend row can have.
export function isTempRoleId(id: number): boolean {
  return id < 0;
}

export function isTempRole(role: Role): boolean {
  return isTempRoleId(role.id);
}

// Slots a brand-new role in cleanly below every existing role, fitting the
// normal 10/20/30... scheme instead of an arbitrary placeholder that would
// tie every un-renumbered new role together at the same rank.
export function nextBottomRank(roles: Role[]): number {
  return (roles.length ? Math.max(...roles.map((r) => r.rank)) : 0) + RANK_STEP;
}

// "New Role", then "New Role 2", "New Role 3"... — the backend rejects
// duplicate labels, so creating several unedited roles in a row needs unique
// defaults rather than colliding on the same name.
export function defaultNewRoleLabel(existingLabels: string[]): string {
  const taken = new Set(existingLabels);
  if (!taken.has("New Role")) return "New Role";
  let n = 2;
  while (taken.has(`New Role ${n}`)) n++;
  return `New Role ${n}`;
}

// Consecutive roles sharing a rank are peers — neither can edit the other
// (see validate_rank_bound's `rank <= actor_rank`) — so they're treated as one
// group instead of a flat list.
export function groupByRank(roles: Role[]): Role[][] {
  const groups: Role[][] = [];
  for (const role of roles) {
    const last = groups[groups.length - 1];
    if (last && last[0].rank === role.rank) last.push(role);
    else groups.push([role]);
  }
  return groups;
}

// Identity of an ordering: group boundaries + membership, ignoring rank values.
// Two orderings with the same signature are the same list to the user.
function signature(groups: Role[][]): string {
  return groups.map((g) => [...g].map((r) => r.id).sort((a, b) => a - b).join(",")).join("|");
}

// Renumbers to RANK_STEP multiples. Groups up to and including the last one
// holding a locked role keep their ranks — a locked role's rank is outside the
// actor's authority, so writing a new value there would be rejected.
function renumber(groups: Role[][], isLocked: (role: Role) => boolean): Role[] {
  let lastLocked = -1;
  groups.forEach((group, i) => { if (group.some(isLocked)) lastLocked = i; });

  // Anchor on the lowest rank already in the renumbered run, not on whichever
  // role currently sits first — otherwise ranks drift upward every drag. The
  // max() keeps the run strictly below the preserved prefix in authority.
  const preserved = groups.slice(0, lastLocked + 1).flat();
  const region = groups.slice(lastLocked + 1).flat();
  const prefixMax = preserved.length ? Math.max(...preserved.map((r) => r.rank)) : -RANK_STEP;
  const out: Role[] = [];
  let rank = region.length
    ? Math.max(Math.min(...region.map((r) => r.rank)), prefixMax + RANK_STEP)
    : 0;

  groups.forEach((group, i) => {
    // Server lists roles by (rank, label) — match it so the draft doesn't
    // re-shuffle the moment a save round-trips.
    const sorted = [...group].sort((a, b) => a.label.localeCompare(b.label));
    if (i <= lastLocked) {
      out.push(...sorted);
      return;
    }
    for (const role of sorted) out.push({ ...role, rank });
    rank += RANK_STEP;
  });
  return out;
}

// Applies a drop and returns the fully renumbered list, or null when the drop
// wouldn't change the ordering at all (joining a group you're already in,
// or either side of a boundary you already sit on).
export function applyDrop(
  roles: Role[],
  draggedId: number,
  targetId: number,
  zone: DropZoneKind,
  isLocked: (role: Role) => boolean,
): Role[] | null {
  const dragged = roles.find((r) => r.id === draggedId);
  const target = roles.find((r) => r.id === targetId);
  if (!dragged || !target || dragged.id === target.id) return null;
  if (isLocked(dragged) || isLocked(target)) return null;

  const before = groupByRank(roles);
  const others = roles.filter((r) => r.id !== dragged.id);
  const groups = groupByRank(others).map((g) => [...g]);

  // "above"/"below" both name an insertion boundary; a boundary that falls
  // inside an existing tie group isn't a boundary at all, so it means "join".
  const idx = others.findIndex((r) => r.id === target.id);
  const neighbour = zone === "above" ? others[idx - 1] : others[idx + 1];
  const internal = neighbour !== undefined && neighbour.rank === target.rank;

  const gi = groups.findIndex((g) => g.some((r) => r.id === target.id));
  if (zone === "join" || internal) groups[gi].push(dragged);
  else groups.splice(zone === "above" ? gi : gi + 1, 0, [dragged]);

  const after = renumber(groups, isLocked);
  return signature(groupByRank(after)) === signature(before) ? null : after;
}

// Only roles whose rank actually moved get sent — locked roles never move, so
// they never end up in a payload the backend would reject.
export function rankChanges(baseline: Role[], draft: Role[]): { role_id: number; rank: number }[] {
  const before = new Map(baseline.map((r) => [r.id, r.rank]));
  return draft
    .filter((r) => before.get(r.id) !== r.rank)
    .map((r) => ({ role_id: r.id, rank: r.rank }));
}
