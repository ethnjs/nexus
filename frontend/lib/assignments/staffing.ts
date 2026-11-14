import type { Assignment, TournamentEvent } from "@/lib/api";
import type { StaffingOption } from "@/lib/eventTrackDetails";

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
 * Seats still to fill across an event — the same arithmetic each track's
 * progress ring does, totalled.
 *
 * Over-staffing does not subtract: a track with three of a needed two is
 * short by nothing, not short by minus one, and letting it cancel out another
 * track's gap would file an event with a real hole as fully staffed.
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
    for (const need of detail.needs ?? []) {
      unfilled += Math.max(0, need.count - staffedCount(rows, need.role_id, detail.track_id));
    }
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
