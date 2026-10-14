import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 640px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// Tracks a single (max-width: 640px) media query. Layout code reads this to
// switch between desktop and mobile arrangements without a CSS file.
// Desktop on the server and during hydration.
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
