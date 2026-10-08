import { buildingsApi, TournamentBuilding } from "@/lib/api";

/**
 * The building called `name`, available on `trackId` — created if no building
 * has that name yet, tagged onto the track if one does but isn't on it.
 *
 * Matched case-insensitively against `known`: names are unique per tournament,
 * so a second "Rowland Hall" would 409, and the TD plainly means the same one.
 * The caller merges the result back into its own building list.
 */
export async function ensureBuildingOnTrack(
  tournamentId: number, name: string, trackId: number, known: readonly TournamentBuilding[],
): Promise<TournamentBuilding> {
  const existing = known.find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (!existing) return buildingsApi.create(tournamentId, { name, track_ids: [trackId] });
  if (existing.track_ids.includes(trackId)) return existing;
  return buildingsApi.update(tournamentId, existing.id, { track_ids: [...existing.track_ids, trackId] });
}
