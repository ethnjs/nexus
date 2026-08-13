"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface NavGuard {
  dirty: boolean;
  /** Pathname prefix that counts as staying put — links under it navigate freely. */
  stayWithin?: string;
}

interface UnsavedChangesValue {
  setGuard: (guard: NavGuard | null) => void;
  /** Wrap any programmatic navigation (router.push, logout) that leaves the guarded subtree. */
  guard: (proceed: () => void) => void;
}

// Default is a pass-through so Topbar/UserAvatar still work on routes that
// don't mount the provider.
const UnsavedChangesContext = createContext<UnsavedChangesValue>({
  setGuard: () => {},
  guard: (proceed) => proceed(),
});

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}

// Registers a subtree's dirty state with the nearest provider.
export function useBlockNavigation(dirty: boolean, stayWithin?: string) {
  const { setGuard } = useUnsavedChanges();
  useEffect(() => {
    setGuard({ dirty, stayWithin });
    return () => setGuard(null);
  }, [setGuard, dirty, stayWithin]);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [guardState, setGuardState] = useState<NavGuard | null>(null);
  const [pending, setPending] = useState<{ run: () => void } | null>(null);

  // useBlockNavigation only re-registers when these actually change, so the
  // listeners below aren't re-bound on every keystroke.
  const dirty = !!guardState?.dirty;
  const stayWithin = guardState?.stayWithin;

  const guard = useCallback((proceed: () => void) => {
    if (!dirty) { proceed(); return; }
    setPending({ run: proceed });
  }, [dirty]);

  // Real browser navigation (refresh, typed URL, tab close). The native prompt
  // is the only option here — it can't be swapped for our own modal.
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // App Router has no routeChangeStart to hook, so in-app navigation is caught
  // at the source: a capture-phase click on any <a> leaving the guarded
  // subtree. Only installed while dirty, so every other page is untouched.
  useEffect(() => {
    if (!dirty) return;
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;
      const anchor = e.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      if (stayWithin && url.pathname.startsWith(stayWithin)) return;

      e.preventDefault();
      e.stopPropagation();
      const href = url.pathname + url.search;
      setPending({ run: () => router.push(href) });
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [dirty, stayWithin, router]);

  const value = useMemo(() => ({ setGuard: setGuardState, guard }), [guard]);

  function handleLeave() {
    const run = pending?.run;
    setPending(null);
    run?.();
  }

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}

      {pending && (
        <Modal title="Unsaved changes" onClose={() => setPending(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              You have unsaved changes. Leaving this page will discard them.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
              <Button type="button" variant="secondary" onClick={() => setPending(null)}>Stay</Button>
              <Button type="button" variant="danger" onClick={handleLeave}>Discard changes</Button>
            </div>
          </div>
        </Modal>
      )}
    </UnsavedChangesContext.Provider>
  );
}
