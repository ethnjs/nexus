"use client";

/**
 * The page's own title (and tabs), lent to the Topbar while the page has its
 * header collapsed.
 *
 * The same trick as useLayoutPanel: the Topbar is a sibling of <main>, so a
 * page cannot render into it by nesting. It registers here instead, and the
 * bar reads what is registered.
 *
 * Nothing in here knows about any particular page — a page opts in by
 * rendering CollapsibleHeader instead of PageHeader, which is the whole of
 * what adopting this costs elsewhere.
 */
import {
  createContext, ReactNode, useCallback, useContext, useMemo, useState,
} from "react";

export interface PageCrumbTab {
  key: string;
  label: string;
}

export interface PageCrumb {
  /** The page's heading — "Assignments". */
  title: string;
  /** The tabs the page would otherwise show under its header. Omitted or
   *  empty, the bar shows the title alone. */
  tabs?: PageCrumbTab[];
  activeKey?: string;
  onChange?: (key: string) => void;
  /** Puts the page's own header back. The bar's caret calls it, so the two
   *  carets are one control in the two places the header can be. */
  onExpand: () => void;
}

interface PageCrumbSetters {
  setCrumb: (crumb: PageCrumb) => void;
  clearCrumb: () => void;
}

const PageCrumbContext = createContext<PageCrumb | null>(null);

// Defaults are no-ops so a page using the hook still works under a layout
// that never mounts the provider — the header simply collapses into nothing.
const PageCrumbSetContext = createContext<PageCrumbSetters>({
  setCrumb: () => {},
  clearCrumb: () => {},
});

/** What the Topbar should show, or null while no page has collapsed. */
export function usePageCrumb() {
  return useContext(PageCrumbContext);
}

/** Register/clear the crumb — for CollapsibleHeader, not for pages. */
export function useSetPageCrumb() {
  return useContext(PageCrumbSetContext);
}

export function PageCrumbProvider({ children }: { children: ReactNode }) {
  const [crumb, setCrumbState] = useState<PageCrumb | null>(null);

  const setCrumb = useCallback((next: PageCrumb) => setCrumbState(next), []);
  const clearCrumb = useCallback(() => setCrumbState(null), []);
  const setters = useMemo(() => ({ setCrumb, clearCrumb }), [setCrumb, clearCrumb]);

  return (
    <PageCrumbSetContext.Provider value={setters}>
      <PageCrumbContext.Provider value={crumb}>
        {children}
      </PageCrumbContext.Provider>
    </PageCrumbSetContext.Provider>
  );
}
