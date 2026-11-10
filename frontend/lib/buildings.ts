import { buildingsApi, type TournamentBuilding, type TournamentRoom } from "@/lib/api";

/** What a building is called in event locations and pickers: "RH", else "Rowland Hall". */
export function buildingLabel(building: Pick<TournamentBuilding, "name" | "short_name">): string {
  return building.short_name || building.name;
}

/** The full name under a picker row that shows `label`, when the label is a short name. */
export function buildingSubtitle(
  buildings: readonly TournamentBuilding[],
  label: string,
): string | undefined {
  return buildings.find((b) => b.short_name && b.short_name === label)?.name;
}

/**
 * The building called `name` (or with that short name), available on
 * `trackId` — created if no building matches, tagged onto the track if one
 * does but isn't on it.
 *
 * Matched case-insensitively against `known`: names are unique per tournament,
 * so a second "Rowland Hall" would 409, and the TD plainly means the same one.
 * The caller merges the result back into its own building list.
 */
export async function ensureBuildingOnTrack(
  tournamentId: number,
  name: string,
  trackId: number,
  known: readonly TournamentBuilding[],
): Promise<TournamentBuilding> {
  const typed = name.toLowerCase();
  const existing =
    known.find((b) => b.name.toLowerCase() === typed) ??
    known.find((b) => b.short_name?.toLowerCase() === typed);
  if (!existing) return buildingsApi.create(tournamentId, { name, track_ids: [trackId] });
  if (existing.track_ids.includes(trackId)) return existing;
  return buildingsApi.update(tournamentId, existing.id, {
    track_ids: [...existing.track_ids, trackId],
  });
}

/**
 * Ids for room `names` in `building`, creating the ones it doesn't have.
 * Names match case-insensitively, so "lab b" finds "Lab B". Returns the
 * building with its updated rooms alongside the ids, in the order given.
 */
export async function ensureRooms(
  tournamentId: number,
  building: TournamentBuilding,
  names: readonly string[],
): Promise<{ building: TournamentBuilding; roomIds: number[] }> {
  const wanted = names.map((n) => n.trim()).filter(Boolean);
  const find = (rooms: readonly TournamentRoom[], name: string) =>
    rooms.find((r) => r.name.toLowerCase() === name.toLowerCase());

  let rooms = building.rooms;
  const missing = wanted.filter((name) => !find(rooms, name));
  if (missing.length > 0) {
    rooms = await buildingsApi.addRooms(tournamentId, building.id, missing);
  }
  const roomIds = wanted.flatMap((name) => {
    const room = find(rooms, name);
    return room ? [room.id] : [];
  });
  return { building: { ...building, rooms }, roomIds: [...new Set(roomIds)] };
}
