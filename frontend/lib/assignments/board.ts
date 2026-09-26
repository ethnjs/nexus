/**
 * The assignments board's shared vocabulary — the few pure helpers both the
 * page and the components it renders need to agree on.
 *
 * They live here rather than in either because the page owns the writes and
 * the components own the drawing, and both have to file a row under the same
 * bar: a handler rebuilding a lane and the chip drawing it must key it the
 * same way or the write lands on a different bar than the one you dragged.
 */
import { buildLanes as buildAssignmentLanes, type AssignmentRole } from "@/lib/assignments/lanes";
import type { Assignment, Role, TournamentEvent, TournamentTrack } from "@/lib/api";

/**
 * What a chip can do to the bar it draws.
 *
 * Bundled rather than passed one prop at a time because every one of them is
 * the page's to perform — a chip knows which lane it is, not how to write it
 * — so they travel together from the board down to the chip and were being
 * restated at each of the four layers in between.
 */
export interface ChipHandlers {
  /** Adds or removes one role, leaving the rest — the multi-select path. */
  onToggleRole: (laneKey: string, eventId: number, role: AssignmentRole) => void;
  /** Replaces every role this person holds here with the one picked. */
  onPickRole: (laneKey: string, eventId: number, role: AssignmentRole) => void;
  /** Drops the whole bar — every shift, every role. */
  onRemove: (laneKey: string, eventId: number) => void;
}

/** Every write an event row can start, chip-level ones included. */
export interface BoardHandlers extends ChipHandlers {
  onResize: (laneKey: string, eventId: number, edge: "start" | "end", index: number) => void;
  /** Fires once, on release — syncs the whole gesture's net change rather
   *  than one write per pointermove. `beforeRows` is the lane's rows as of
   *  pointerdown. */
  onResizeCommit: (laneKey: string, eventId: number, beforeRows: Assignment[]) => void;
  /** Repoints a track's default role, migrating whoever still holds the old
   *  one on that track. The page owns it: only it holds every track's and
   *  every assignment's state. */
  onPickDefaultRole: (track: TournamentTrack, role: Role) => Promise<void>;
}

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
