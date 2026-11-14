import type {
  EventTrackDetail,
  EventTrackDetailRead,
  Role,
  TournamentEvent,
  TournamentRoom,
} from "@/lib/api";

/**
 * Rebuilding an event's `track_details` for a write.
 *
 * Two levels of whole-set, and both bite:
 *
 *  1. **Across tracks.** `track_details` replaced the old `track_ids`, so a
 *     PATCH that sends one entry says "this event runs on exactly this one
 *     track" — every other track is unlinked, taking its location, its
 *     staffing needs and its place on the board with it.
 *
 *  2. **Within an entry.** An entry states what the arrangement on that track
 *     *is*. Omitting `needs` clears the needs; omitting `room_ids` clears the
 *     rooms. Only leaving the track out entirely keeps what it had.
 *
 * So any edit to one track has to resend every track, in full. That is what
 * these do — never hand-build a track_details array at a call site.
 */

/** One read entry back into the shape a write expects, losing nothing. */
export function toTrackDetailInput(detail: EventTrackDetailRead): EventTrackDetail {
  return {
    track_id: detail.track_id,
    floor: detail.floor,
    room_ids: detail.room_ids,
    // Dropped here and the event silently loses its staffing needs on save.
    needs: detail.needs.map((need) => ({ role_id: need.role_id, count: need.count })),
    over_18_needed: detail.over_18_needed,
    over_21_needed: detail.over_21_needed,
  };
}

/**
 * The event's full track_details with one track's entry patched.
 *
 * A track the event isn't on yet is added rather than ignored — that is how
 * an event joins a track from a location editor.
 */
export function withTrackDetail(
  event: Pick<TournamentEvent, "track_details">,
  trackId: number,
  updates: Partial<Omit<EventTrackDetail, "track_id">>,
): EventTrackDetail[] {
  const existing = event.track_details.find((d) => d.track_id === trackId);
  const base: EventTrackDetail = existing
    ? toTrackDetailInput(existing)
    : { track_id: trackId, floor: null, room_ids: [], needs: [] };

  return [
    ...event.track_details.filter((d) => d.track_id !== trackId).map(toTrackDetailInput),
    { ...base, ...updates },
  ];
}

/** Where an event sits on one track, or undefined if it isn't on that track. */
export function trackDetail(
  event: Pick<TournamentEvent, "track_details">,
  trackId: number,
): EventTrackDetailRead | undefined {
  return event.track_details.find((d) => d.track_id === trackId);
}

/** A room's floor: its override, else the leading digit of its name ("210" →
 *  "2"; "Lobby" has none). Mirrors TournamentRoom.effective_floor. */
export function roomFloor(room: Pick<TournamentRoom, "name" | "floor">): string | null {
  if (room.floor) return room.floor;
  const first = room.name.trim()[0];
  return first && /\d/.test(first) ? first : null;
}

/** The floor the server derives for a placement with no override: its first
 *  room's floor. Mirrors TournamentEventTrack.effective_floor. */
export function derivedFloor(rooms: readonly TournamentRoom[]): string | null {
  return rooms.length > 0 ? roomFloor(rooms[0]) : null;
}

/** What one track asks for in people: its role needs and the any-role age rules. */
export type TrackStaffing = Pick<EventTrackDetail, "needs" | "over_18_needed" | "over_21_needed">;

export const AGE_RULES = [
  { key: "over_18_needed", label: "18+" },
  { key: "over_21_needed", label: "21+" },
] as const;

/** One thing a track's staffing can ask for: a role, or an age in any role. */
export type StaffingOption =
  | { kind: "role"; id: number; label: string }
  | { kind: "age"; key: (typeof AGE_RULES)[number]["key"]; label: string };

export const staffingKey = (o: StaffingOption) => (o.kind === "role" ? `role:${o.id}` : o.key);

export const staffingGroup = (o: StaffingOption) => (o.kind === "role" ? "Roles" : "Age, any role");

/** Every option, roles first, in the order a picker groups them. */
export function staffingOptions(roles: readonly Role[]): StaffingOption[] {
  return [
    ...roles.map((r) => ({ kind: "role" as const, id: r.id, label: r.label })),
    ...AGE_RULES.map((rule) => ({ kind: "age" as const, ...rule })),
  ];
}

/** The options this track asks for, roles in their stored order, then ages. */
export function chosenStaffing(staffing: TrackStaffing, roles: readonly Role[]): StaffingOption[] {
  return [
    ...(staffing.needs ?? []).map((n) => ({
      kind: "role" as const,
      id: n.role_id,
      label: roles.find((r) => r.id === n.role_id)?.label ?? "Role",
    })),
    ...AGE_RULES.filter((rule) => staffing[rule.key] != null).map((rule) => ({
      kind: "age" as const,
      ...rule,
    })),
  ];
}

export function staffingCount(staffing: TrackStaffing, option: StaffingOption): number {
  return option.kind === "role"
    ? ((staffing.needs ?? []).find((n) => n.role_id === option.id)?.count ?? 1)
    : (staffing[option.key] ?? 1);
}

/** `staffing` with one option's count set, or removed when null. A changed
 *  role count keeps its place in the list. */
export function withStaffingCount<T extends TrackStaffing>(
  staffing: T,
  option: StaffingOption,
  count: number | null,
): T {
  if (option.kind === "age") return { ...staffing, [option.key]: count };
  const needs = staffing.needs ?? [];
  const at = needs.findIndex((n) => n.role_id === option.id);
  const rest = needs.filter((n) => n.role_id !== option.id);
  if (count === null) return { ...staffing, needs: rest };
  const next = { role_id: option.id, count };
  return {
    ...staffing,
    needs: at === -1 ? [...rest, next] : [...rest.slice(0, at), next, ...rest.slice(at)],
  };
}
