import { displayConfigApi, type DisplayConfigSurface } from "@/lib/api";

/**
 * Write-back for a table's own view state (filters, sort) into one surface of
 * this viewer's display config.
 *
 * Re-reads before writing, because a PUT replaces every surface at once and
 * other controls (a Display modal, another table) write their own surfaces
 * into the same blob — see useDisplayConfigDraft, which merges from the other
 * side for the same reason. Fire-and-forget: failing to remember a sort order
 * is not worth interrupting the table over.
 */
export function persistSurfaceView(tournamentId: number, surface: string, patch: Partial<DisplayConfigSurface>) {
  displayConfigApi.get(tournamentId)
    .then((fresh) => displayConfigApi.set(tournamentId, {
      ...fresh,
      // A surface that has never been saved still needs its required
      // `hidden` key, hence the spread order.
      [surface]: { ...{ hidden: [] }, ...fresh[surface], ...patch },
    }))
    .catch(() => {});
}
