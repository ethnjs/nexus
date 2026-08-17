import { TournamentEvent } from "@/lib/api";

export function eventName(e: TournamentEvent): string {
  return e.event?.name ?? e.name ?? "—";
}

// Name alone can collide across divisions (e.g. two "Chess" events, one per
// division) — pair it with the division so a results report unambiguously
// identifies which row it's talking about. No separator: reads as one label
// ("Chess A"), not name-then-division.
export function eventNameWithDivision(e: TournamentEvent): string {
  return e.division ? `${eventName(e)} ${e.division}` : eventName(e);
}
