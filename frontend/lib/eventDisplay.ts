import { TournamentEvent } from "@/lib/api";

/** The minimum an event has to carry to be named. Stated structurally rather
 *  than as TournamentEvent so the slimmer refs nested on other responses
 *  — TournamentEventMember on an Assignment — can be named by the same
 *  helper instead of re-deriving the convention at each call site. */
type NameableEvent = {
  name: string | null;
  event?: { name: string | null } | null;
};

export function eventName(e: NameableEvent): string {
  return e.event?.name ?? e.name ?? "—";
}

// Name alone can collide across divisions (e.g. two "Chess" events, one per
// division) — pair it with the division so a results report unambiguously
// identifies which row it's talking about. No separator: reads as one label
// ("Chess A"), not name-then-division.
export function eventNameWithDivision(e: NameableEvent & { division: string | null }): string {
  return e.division ? `${eventName(e)} ${e.division}` : eventName(e);
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
