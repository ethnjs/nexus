import { displayConfigApi, type DisplayConfigSurface } from "@/lib/api";

/**
 * Write-back for a table's own view state (filters, sort) into one surface of
 * this viewer's display config.
 *
 * Re-reads before writing, because a PUT replaces every surface at once and
 * other controls (a Display modal, another table) write their own surfaces
 * into the same blob — see useDisplayConfigDraft, which merges from the other
 * side for the same reason. Never rejects: failing to remember a sort order
 * is not worth interrupting the table over. Resolves to whether it saved, for
 * a caller whose next fetch depends on the saved view (the members roster).
 */
export function persistSurfaceView(
  tournamentId: number, surface: string, patch: Partial<DisplayConfigSurface>,
): Promise<boolean> {
  return displayConfigApi.get(tournamentId)
    .then((fresh) => displayConfigApi.set(tournamentId, {
      ...fresh,
      // A surface that has never been saved still needs its required
      // `hidden` key, hence the spread order.
      [surface]: { ...{ hidden: [] }, ...fresh[surface], ...patch },
    }))
    .then(() => true, () => false);
}
