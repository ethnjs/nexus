"use client";

import { useEffect, useRef } from "react";

// Focus and visibilitychange usually fire together on a tab switch — one
// refetch is enough.
const MIN_INTERVAL_MS = 1000;

/** Runs `refetch` whenever this tab comes back into view — the cheap way to
 *  pick up what a collaborator changed while this viewer was elsewhere. */
export function useRefetchOnFocus(refetch: () => void, enabled = true) {
  // Read through a ref so a fresh closure each render doesn't re-subscribe.
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; });

  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    function handle() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < MIN_INTERVAL_MS) return;
      last = now;
      refetchRef.current();
    }
    document.addEventListener("visibilitychange", handle);
    window.addEventListener("focus", handle);
    return () => {
      document.removeEventListener("visibilitychange", handle);
      window.removeEventListener("focus", handle);
    };
  }, [enabled]);
}
