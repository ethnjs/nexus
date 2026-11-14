import type { Assignment, EventTrackDetailRead, TournamentEvent } from "@/lib/api";
import { AGE_RULES, type StaffingOption } from "@/lib/eventTrackDetails";

/**
 * How many distinct members hold one role on one track — never a row count.
 *
 * A member spanning morning and afternoon shifts on the same track is two
 * assignment rows (one per shift) but one person, so counting rows would make
 * splitting a shift in two look like hiring somebody new.
 */
export function staffedCount(rows: readonly Assignment[], roleId: number, trackId: number): number {
  const members = new Set<number | null>();
  for (const row of rows) {
    if (row.role.id === roleId && row.track.id === trackId) members.add(row.member.membership_id);
  }
  return members.size;
}

/**
 * Each need's shortfall on one track, roles then the age rules. Over-staffing
 * doesn't go negative: three of a needed two is short by nothing.
 */
export function trackShortfalls(
  detail: EventTrackDetailRead,
  rows: readonly Assignment[],
): { roles: number[]; ages: number[] } {
  return {
    roles: (detail.needs ?? []).map((need) =>
      Math.max(0, need.count - staffedCount(rows, need.role_id, detail.track_id)),
    ),
    ages: AGE_RULES.filter((rule) => detail[rule.key] != null).map((rule) =>
      Math.max(0, (detail[rule.key] ?? 0) - ageStaffedCount(rows, rule.flag, detail.track_id)),
    ),
  };
}

/**
 * The fewest more people an event needs, for the Staffing sort.
 *
 * Per track, the larger of the role gaps summed and each age gap: age rules
 * are conditions on the same people who fill the roles, so a 21+ hire into a
 * missing role closes that role's gap and both age gaps at once. Tracks add up,
 * so a gap on one day is never cancelled out by surplus on another.
 *
 * `showsTrack` keeps it to what the viewer is looking at, so a board on Day 2
 * sorts by Day 2's gaps rather than by a total that includes a day they
 * cannot see.
 */
export function unfilledCount(
  event: TournamentEvent,
  rows: readonly Assignment[],
  showsTrack: (trackId: number) => boolean,
): number {
  let unfilled = 0;
  for (const detail of event.track_details) {
    if (!showsTrack(detail.track_id)) continue;
    const { roles, ages } = trackShortfalls(detail, rows);
    unfilled += Math.max(
      roles.reduce((sum, gap) => sum + gap, 0),
      ...ages,
    );
  }
  return unfilled;
}

/** How many distinct members on one track are known to be 18+ / 21+. A
 *  member whose flag is withheld or not collected doesn't count. */
export function ageStaffedCount(
  rows: readonly Assignment[],
  flag: "is_over_18" | "is_over_21",
  trackId: number,
): number {
  const members = new Set<number | null>();
  for (const row of rows) {
    if (row.track.id === trackId && row.member[flag] === true)
      members.add(row.member.membership_id);
  }
  return members.size;
}

/** Distinct members on one track counting toward one staffing option. */
export function staffingFilled(
  rows: readonly Assignment[],
  option: StaffingOption,
  trackId: number,
): number {
  return option.kind === "role"
    ? staffedCount(rows, option.id, trackId)
    : ageStaffedCount(rows, option.flag, trackId);
}
