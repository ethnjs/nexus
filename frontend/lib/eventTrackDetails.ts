import type { EventTrackDetail, EventTrackDetailRead, TournamentEvent } from "@/lib/api";

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
 *     *is*. Omitting `needs` clears the needs; omitting `rooms` clears the
 *     rooms. Only leaving the track out entirely keeps what it had.
 *
 * So any edit to one track has to resend every track, in full. That is what
 * these do — never hand-build a track_details array at a call site.
 */

/** One read entry back into the shape a write expects, losing nothing. */
export function toTrackDetailInput(detail: EventTrackDetailRead): EventTrackDetail {
  return {
    track_id: detail.track_id,
    building_id: detail.building_id,
    floor: detail.floor,
    rooms: detail.rooms,
    // Dropped here and the event silently loses its staffing needs on save.
    needs: detail.needs.map((need) => ({ role_id: need.role_id, count: need.count })),
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
    : { track_id: trackId, building_id: null, floor: null, rooms: [], needs: [] };

  return [
    ...event.track_details
      .filter((d) => d.track_id !== trackId)
      .map(toTrackDetailInput),
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
