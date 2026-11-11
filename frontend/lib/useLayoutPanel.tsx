"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export interface LayoutPanelPart {
  content: ReactNode;
  width: number;
}

/** `floating` covers the right edge of the page; `docked` takes width from it, so a list the user drags from stays beside the page it drops onto. */
export interface LayoutPanel {
  floating: LayoutPanelPart | null;
  docked: LayoutPanelPart | null;
}

interface LayoutPanelSetters {
  /** Pass `null` content for no floating panel (only a docked one). */
  setPanel: (content: ReactNode, width: number, docked?: LayoutPanelPart) => void;
  clearPanel: () => void;
}

// Split into two contexts on purpose: the *setters* value is stable, so a
// descendant that only registers content (the events page) doesn't re-render every
// time the content changes. Sharing one context would mean setPanel ->
// re-render -> new callbacks -> setPanel, i.e. an update loop.
const LayoutPanelContentContext = createContext<LayoutPanel | null>(null);

// Defaults are no-ops so components using the hook still work on routes that
// don't mount the provider (same defensive pattern as useUnsavedChanges).
const LayoutPanelSetContext = createContext<LayoutPanelSetters>({
  setPanel: () => {},
  clearPanel: () => {},
});

/** Read the currently registered panel — for the layout shell that renders it. */
export function useLayoutPanelContent() {
  return useContext(LayoutPanelContentContext);
}

/** Register/clear what the layout-level panel slot should show. */
export function useSetLayoutPanel() {
  return useContext(LayoutPanelSetContext);
}

export function LayoutPanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanelState] = useState<LayoutPanel | null>(null);

  const setPanel = useCallback((content: ReactNode, width: number, docked?: LayoutPanelPart) => {
    setPanelState({
      floating: content == null ? null : { content, width },
      docked: docked ?? null,
    });
  }, []);
  const clearPanel = useCallback(() => setPanelState(null), []);

  const setters = useMemo(() => ({ setPanel, clearPanel }), [setPanel, clearPanel]);

  return (
    <LayoutPanelSetContext.Provider value={setters}>
      <LayoutPanelContentContext.Provider value={panel}>
        {children}
      </LayoutPanelContentContext.Provider>
    </LayoutPanelSetContext.Provider>
  );
}
