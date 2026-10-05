import { TournamentEvent } from "@/lib/api";

/** The minimum an event has to carry to be named. Stated structurally rather
 *  than as TournamentEvent so the slimmer refs nested on other responses
 *  — TournamentEventMember on an Assignment — can be named by the same
 *  helper instead of re-deriving the convention at each call site. */
type NameableEvent = {
  name: string | null;
  event?: { name: string | null } | null;
};

/** The event's own name wins: on a custom event it's the only name, and on a
 *  catalog-linked one it's this tournament's override of the catalog's.
 *  Same order as TournamentEvent.display_name on the server. */
export function eventName(e: NameableEvent): string {
  return e.name ?? e.event?.name ?? "—";
}

// Name alone can collide across divisions (e.g. two "Chess" events, one per
// division) — pair it with the division so a results report unambiguously
// identifies which row it's talking about. No separator: reads as one label
// ("Chess A"), not name-then-division.
export function eventNameWithDivision(e: NameableEvent & { division: string | null }): string {
  return e.division ? `${eventName(e)} ${e.division}` : eventName(e);
}

/**
 * Where one track of an event happens: "Kerckhoff 101, 103".
 *
 * Building and room only, as one string — the floor is stored and edited per
 * track, but a room number already implies it to anyone reading a board, and
 * spelling it out made the commonest line on a row a third longer.
 *
 * One string is also the whole of how it sorts: a board ordered by location
 * is a walking order, and splitting it into building, then floor, then room
 * would sort by three keys nobody asked about instead of by the label they
 * are reading. Room numbers inside it still order naturally, since the
 * comparator is numeric-aware (101 before 1001).
 */
export function trackLocationLabel(
  detail: { building_name: string | null; rooms: string[] } | null | undefined,
): string | null {
  if (!detail?.building_name) return null;
  return [detail.building_name, detail.rooms.join(", ")].filter(Boolean).join(" ");
}

// The first day an event runs. An event has no dates of its own — its
// schedule is the union of its shifts — so this is the earliest shift's
// date, and "" for an event with none (anything on a cosmetic track).
// Date-only and ISO, so it sorts as a string.
export function eventFirstDay(e: TournamentEvent): string {
  return e.shifts
    .reduce((earliest, s) => (!earliest || s.start < earliest ? s.start : earliest), "")
    .slice(0, 10);
}
