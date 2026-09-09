import { DisplayConfig, DisplayConfigSurface, displayConfigApi } from "@/lib/api";

/**
 * Save a patch onto one surface of the caller's display config.
 *
 * Re-reads before writing because the PUT replaces the *whole* column at
 * once: a page that PUT only the surface it owns would wipe every other
 * surface's saved state, and two controls on the same page (a Filter modal
 * and a Display modal) would clobber each other's half of the same surface.
 *
 * Fire-and-forget on purpose. Failing to remember a filter is not worth
 * interrupting the board with an error toast — the view the coordinator is
 * looking at already changed locally.
 */
export function persistDisplayConfigSurface(
  tournamentId: number,
  surface: string,
  patch: Partial<DisplayConfigSurface>,
): void {
  displayConfigApi.get(tournamentId)
    .then((fresh: DisplayConfig) => displayConfigApi.set(tournamentId, {
      ...fresh,
      // A surface that has never been saved still needs its required
      // `hidden` key. Spread rather than written inline so a patch carrying
      // its own `hidden` wins instead of being flagged as a duplicate key.
      [surface]: { ...{ hidden: [] as string[] }, ...fresh[surface], ...patch },
    }))
    .catch(() => {});
}
