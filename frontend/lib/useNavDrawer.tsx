"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

interface NavDrawerValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

// Default is inert so a Topbar on a route with no drawer (profile, forms,
// onboarding) still renders without a provider above it.
const NavDrawerContext = createContext<NavDrawerValue>({
  open: false,
  setOpen: () => {},
});

export function useNavDrawer() {
  return useContext(NavDrawerContext);
}

/**
 * Holds the mobile nav drawer's open state for one shell.
 *
 * It lives in a context rather than in the drawer component because the button
 * that opens it renders inside the Topbar, which is the drawer's sibling. The
 * toggle used to be a position:fixed overlay owned by the drawer, but a fixed
 * element is anchored to the viewport while the Topbar is sticky and anchored
 * to the document — so during overscroll (pull-to-refresh on iOS) the bar slid
 * down and the button stayed behind, visibly detaching.
 *
 * Wrap whatever subtree contains both the Topbar and the drawer.
 */
export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Closes on navigation that didn't come from a nav row and so wouldn't fire
  // its onClick — the tournament switcher, a redirect. Adjusted during render
  // rather than in an effect: React discards this pass and re-renders
  // immediately, with no extra paint in between.
  const [renderedPath, setRenderedPath] = useState(pathname);
  if (renderedPath !== pathname) {
    setRenderedPath(pathname);
    setOpen(false);
  }

  const value = useMemo(() => ({ open, setOpen }), [open]);

  return <NavDrawerContext.Provider value={value}>{children}</NavDrawerContext.Provider>;
}
