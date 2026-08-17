"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

export interface LayoutPanel {
  content: ReactNode;
  /** Horizontal space the panel claims in the layout row, in px. */
  width: number;
}

interface LayoutPanelSetters {
  setPanel: (content: ReactNode, width: number) => void;
  clearPanel: () => void;
}

// Split into two contexts on purpose: the *setters* value is stable, so a
// descendant that only registers content (EventsTab) doesn't re-render every
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

/** Register/clear what the layout-level docked panel slot should show. */
export function useSetLayoutPanel() {
  return useContext(LayoutPanelSetContext);
}

export function LayoutPanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanelState] = useState<LayoutPanel | null>(null);

  const setPanel = useCallback((content: ReactNode, width: number) => {
    setPanelState({ content, width });
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
