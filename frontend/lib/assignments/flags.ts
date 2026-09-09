/**
 * Warnings on an event assignment.
 *
 * Per issue #70 an assignment that contradicts what a member said is legal —
 * a TD can staff someone who marked themselves unavailable, declined the
 * track, or is already booked elsewhere. The backend never blocks any of it.
 * These are what the board shows instead.
 *
 * Computed here rather than server-side because every input already rides on
 * responses the board fetches anyway: shift times on the assignment, the
 * member's availability and track statuses on the roster read. They live in
 * `lib/` rather than in a page so the real assignments page and the sketch
 * share one set of rules instead of each inventing its own.
 *
 * There is no "doesn't hold this role" flag. An assignment points at a
 * tournament_membership_roles row, so a member in a role they don't hold is
 * unrepresentable rather than merely unusual.
 */
import type { Assignment, MembershipFull, TournamentShiftBase } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";

export type FlagCode =
  | "unavailable"
  | "track_unconfirmed"
  | "double_booked"
  | "over_staffed";

export interface Flag {
  code: FlagCode;
  /** Short enough for a chip badge. */
  label: string;
  /** The full sentence, for a tooltip. */
  detail: string;
}

/**
 * The member-side inputs the per-assignment rules read, resolved once.
 *
 * `null` on either set means the field group was not requested — which is not
 * the same as the member having no availability or no statuses. Absent data
 * yields no flag, because "we didn't ask" must never render as "they said no".
 * See rule 2 in field_groups.py: an unrequested group is absent, not empty.
 */
export interface MemberFacts {
  availableShiftIds: ReadonlySet<number> | null;
  trackStatus: ReadonlyMap<number, string> | null;
  assignments: readonly Assignment[];
}

export function memberFacts(
  member: MembershipFull,
  assignments: readonly Assignment[] = member.assignments ?? [],
): MemberFacts {
  return {
    availableShiftIds: member.availability
      ? new Set(member.availability.map((a) => a.shift_id))
      : null,
    trackStatus: member.track_statuses
      ? new Map(member.track_statuses.map((t) => [t.track_id, t.status]))
      : null,
    assignments,
  };
}

/** Strict overlap. Adjacent shifts (one ends exactly as the next starts) are
 *  fine — same rule as the backend's _validate_no_overlap. */
function overlaps(a: TournamentShiftBase, b: TournamentShiftBase): boolean {
  const [aStart, aEnd] = [Date.parse(a.start), Date.parse(a.end)];
  const [bStart, bEnd] = [Date.parse(b.start), Date.parse(b.end)];
  return aStart < bEnd && bStart < aEnd;
}

export interface AssignmentFlagOptions {
  /**
   * Event id → the track ids that event runs on, from the events read
   * (`fields=tracks`). Needed only for shiftless assignments: an assignment
   * normally takes its track from its shift, but a shiftless one (test
   * writing) has no shift to take it from, and the nested `event` is the
   * member-facing shape, which carries no tracks.
   */
  eventTrackIds?: ReadonlyMap<number, readonly number[]>;
}

/**
 * Every warning that applies to one assignment.
 *
 * Silent — correctly — whenever the inputs cannot answer the question: a
 * shiftless assignment has no time to be unavailable for or to clash with,
 * and an unrequested field group is unknown rather than empty.
 */
export function assignmentFlags(
  assignment: Assignment,
  facts: MemberFacts,
  options: AssignmentFlagOptions = {},
): Flag[] {
  const flags: Flag[] = [];
  const { shift } = assignment;

  // Availability is recorded per shift, so an unpinned assignment has nothing
  // to check against — absence of a shift is not absence of availability.
  if (shift && facts.availableShiftIds && !facts.availableShiftIds.has(shift.id)) {
    flags.push({
      code: "unavailable",
      label: "Unavailable",
      detail: `Not available for ${shift.label}.`,
    });
  }

  // A shiftless assignment falls back to the event's own tracks, which only
  // the caller can supply. With several, an unconfirmed status on any one of
  // them is worth surfacing.
  const trackIds = shift
    ? [shift.track_id]
    : (options.eventTrackIds?.get(assignment.event.id) ?? []);

  if (facts.trackStatus) {
    const unconfirmed = trackIds.filter(
      (id) => facts.trackStatus?.get(id) !== "confirmed",
    );
    if (unconfirmed.length > 0) {
      flags.push({
        code: "track_unconfirmed",
        label: "Unconfirmed",
        detail: "Has not confirmed for this track.",
      });
    }
  }

  if (shift) {
    // Same shift on two events counts: that is two rooms at one time, which is
    // exactly the clash worth catching. Compared by time rather than by shift
    // id so overlapping-but-distinct shifts are caught too.
    const clash = facts.assignments.find(
      (other) =>
        other.id !== assignment.id &&
        other.shift !== null &&
        other.event.id !== assignment.event.id &&
        overlaps(other.shift, shift),
    );
    if (clash) {
      flags.push({
        code: "double_booked",
        label: "Double-booked",
        detail: `Also assigned to ${eventNameWithDivision(clash.event)} at this time.`,
      });
    }
  }

  return flags;
}

/**
 * Warnings about an event as a whole rather than about one person on it.
 *
 * `volunteers_needed` is a staffing target and nullable — no target means no
 * flag, and it is absent entirely unless the events read asked for the
 * `location` group.
 */
export function eventFlags(
  event: { id: number; volunteers_needed?: number | null },
  assignments: readonly Assignment[],
): Flag[] {
  const target = event.volunteers_needed;
  if (target == null) return [];

  const staffed = assignments.filter((a) => a.event.id === event.id).length;
  if (staffed <= target) return [];

  return [
    {
      code: "over_staffed",
      label: "Over target",
      detail: `${staffed} assigned, ${target} needed.`,
    },
  ];
}

/** Group a flat assignments response by event id — what the board needs to
 *  hang chips off event rows, now that events don't carry them. */
export function assignmentsByEvent(
  assignments: readonly Assignment[],
): Map<number, Assignment[]> {
  const byEvent = new Map<number, Assignment[]>();
  for (const assignment of assignments) {
    const list = byEvent.get(assignment.event.id);
    if (list) list.push(assignment);
    else byEvent.set(assignment.event.id, [assignment]);
  }
  return byEvent;
}
