/**
 * The assignments board's shared vocabulary — the few pure helpers both the
 * page and the components it renders need to agree on.
 *
 * They live here rather than in either because the page owns the writes and
 * the components own the drawing, and both have to file a row under the same
 * bar: a handler rebuilding a lane and the chip drawing it must key it the
 * same way or the write lands on a different bar than the one you dragged.
 */
import { buildLanes as buildAssignmentLanes } from "@/lib/assignments/lanes";
import type { Assignment, TournamentEvent } from "@/lib/api";

export function fullName(member: { first_name: string | null; last_name: string | null }) {
  return [member.first_name, member.last_name].filter(Boolean).join(" ");
}

/**
 * The same event with its shifts in schedule order.
 *
 * The board reads `shifts` as the timeline itself — the array index is the
 * column, a bar's span is a slice of it, and the boundary times are its
 * starts and ends — so an event whose Impound shift was attached after
 * Morning printed the day as 8am, 12pm, 4pm, 8am. The API sorts these now
 * (TournamentEvent.shifts order_by), and this normalises on arrival anyway:
 * every ordering assumption downstream is local to the board, so this is
 * where it should be guaranteed rather than assumed.
 */
export function withOrderedShifts(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    shifts: [...event.shifts].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.id - b.id,
    ),
  };
}

/** A bar's identity: one member on one event, with a *set* of roles (one row
 *  per shift per role). Shift rows share one key so a bar can span Day 1 and
 *  Day 2; unpinned rows key by track, so a role edit or drag on Test Writing
 *  can't rebuild the Day 1 bar, or vice versa. */
export function laneKeyOf(assignment: Assignment) {
  const member = assignment.member.membership_id;
  return assignment.shift ? `${member}:shifts` : `${member}:track:${assignment.track.id}`;
}

/** The board's bars: one per member on the event, across its shifts. */
export function buildLanes(rowAssignments: Assignment[], shiftIds: number[]) {
  return buildAssignmentLanes(rowAssignments, shiftIds, laneKeyOf);
}
