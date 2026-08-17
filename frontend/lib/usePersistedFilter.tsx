"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilterState, emptyFilterState } from "@/components/ui/FilterModal";

// Scoped per user *and* tournament: logout() doesn't clear localStorage, so an
// unscoped key would leak one account's filters into the next one on a shared
// device (and one tournament's into another).
function storageKeyFor(table: string, userId: number | undefined, tournamentId: number | undefined): string | null {
  if (userId == null || tournamentId == null || !Number.isFinite(tournamentId)) return null;
  return `filters:${userId}:${tournamentId}:${table}`;
}

/**
 * Committed filter state for one table, mirrored into localStorage.
 *
 * Sets don't survive JSON.stringify (they serialize to `{}`), so the stored
 * shape is `{ field: string[] }` and this hook converts both ways.
 *
 * Returns the applied filters plus a setter that persists — call it on Apply
 * / Clear only, never from a draft edit.
 */
export function usePersistedFilter<K extends string>(
  table: string,
  userId: number | undefined,
  tournamentId: number | undefined,
  keys: readonly K[],
): [FilterState<K>, (next: FilterState<K>) => void] {
  // The caller passes an array literal or const tuple; pinning it in a ref
  // keeps it out of effect/callback deps without risking a stale-identity loop.
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const [filters, setFilters] = useState<FilterState<K>>(() => emptyFilterState(keys));

  const storageKey = storageKeyFor(table, userId, tournamentId);

  // Hydrate once per key. `null` (user/tournament still loading) is simply
  // skipped — the effect re-runs when the key materializes.
  const hydratedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!storageKey || hydratedKey.current === storageKey) return;
    hydratedKey.current = storageKey;
    const next = emptyFilterState(keysRef.current);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const key of keysRef.current) {
          const values = parsed[key];
          if (Array.isArray(values)) next[key] = new Set(values.filter((v): v is string => typeof v === "string"));
        }
      }
    } catch {
      // Corrupt entry or storage unavailable (private mode) — fall back to
      // "no filters" rather than breaking the page.
    }
    setFilters(next);
  }, [storageKey]);

  const apply = useCallback((next: FilterState<K>) => {
    setFilters(next);
    if (!storageKey) return;
    try {
      const plain = Object.fromEntries(keysRef.current.map((k) => [k, [...next[k]]]));
      const anyActive = Object.values(plain).some((values) => values.length > 0);
      // Clearing removes the entry outright so a stale "everything shown"
      // blob doesn't linger in storage forever.
      if (anyActive) window.localStorage.setItem(storageKey, JSON.stringify(plain));
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Quota/private-mode failures shouldn't block the in-memory filter.
    }
  }, [storageKey]);

  return [filters, apply];
}
