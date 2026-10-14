import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during the server render and hydration, true after. Gates client-only output such as portals. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
