"use client";

/**
 * Whether the page header is folded into the Topbar — one answer for every
 * page of a tournament, so folding it on Members keeps it folded on Shifts.
 *
 * Saved per member on the server (the `page_header` display-config surface),
 * so it follows them across devices. Also cached in this browser, because the
 * server copy arrives with a request: without the cache a folded header would
 * render open and then fold on every full page load. The server wins once it
 * answers.
 *
 * Outside a provider (a page with no tournament) CollapsibleHeader keeps its
 * own local state instead.
 */
import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore,
} from "react";
import { displayConfigApi } from "@/lib/api";
import { PAGE_HEADER } from "@/lib/displayConfigSurfaces";
import { persistSurfaceView } from "@/lib/persistSurfaceView";

interface HeaderCollapse {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const HeaderCollapseContext = createContext<HeaderCollapse | null>(null);

const cacheKey = (tournamentId: number) => `nexus:header-collapsed:${tournamentId}`;

// Storage can be missing or throw (private mode, blocked site data) — the
// header then just starts open, which is the default anyway.
function readCache(tournamentId: number): boolean | null {
  try {
    const value = window.localStorage.getItem(cacheKey(tournamentId));
    return value === null ? null : value === "true";
  } catch {
    return null;
  }
}

// Another tab folding the header updates this one's cache too.
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function writeCache(tournamentId: number, collapsed: boolean) {
  try {
    window.localStorage.setItem(cacheKey(tournamentId), String(collapsed));
  } catch {
    // Only the cache; the server copy still saves.
  }
}

export function HeaderCollapseProvider({ tournamentId, children }: { tournamentId: number; children: ReactNode }) {
  // Read as an external store rather than into useState: the server render
  // has no localStorage (null there), and the store hands the client its own
  // value without a hydration mismatch.
  const cached = useSyncExternalStore(subscribeStorage, () => readCache(tournamentId), () => null);
  // What the server said, or what was just set here — either outranks the cache.
  const [known, setKnown] = useState<boolean | null>(null);
  const collapsed = known ?? cached ?? false;

  // The server copy wins. A member without manage_members or manage_events
  // can't read the config at all, and keeps the cached value.
  useEffect(() => {
    let current = true;
    displayConfigApi.get(tournamentId)
      .then((config) => {
        const saved = config?.[PAGE_HEADER]?.collapsed;
        if (!current || typeof saved !== "boolean") return;
        setKnown(saved);
        writeCache(tournamentId, saved);
      })
      .catch(() => {});
    return () => { current = false; };
  }, [tournamentId]);

  const setCollapsed = useCallback((next: boolean) => {
    setKnown(next);
    writeCache(tournamentId, next);
    void persistSurfaceView(tournamentId, PAGE_HEADER, { collapsed: next });
  }, [tournamentId]);

  const value = useMemo(() => ({ collapsed, setCollapsed }), [collapsed, setCollapsed]);
  return <HeaderCollapseContext.Provider value={value}>{children}</HeaderCollapseContext.Provider>;
}

/** The tournament's shared fold state, or null outside a tournament. */
export function useHeaderCollapse(): HeaderCollapse | null {
  return useContext(HeaderCollapseContext);
}
