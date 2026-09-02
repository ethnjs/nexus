"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The two mutually-exclusive ways a table row can open a docked panel:
 *
 * - **focus**: "Edit"/"Expand" on a row opens that one row's panel. No
 *   checkboxes; clicking any *other* row switches which one the panel shows.
 * - **select**: explicit Select mode — checkboxes accumulate a selection and
 *   the panel only opens once "Edit" is pressed in the SelectionBar
 *   (`massPanelOpen`), not as soon as a row is checked.
 *
 * Both are frozen while `panelDirty` (reported up by whichever panel is open
 * via its `onDirtyChange`): switching rows or changing the selection would
 * silently throw away in-progress edits, so it's blocked outright — the
 * triggering control disables itself with a "save or discard first" title —
 * rather than guarded behind a confirm dialog.
 */
export interface PanelSelection {
  focusedId: number | null;
  selectMode: boolean;
  selectedIds: Set<number>;
  massPanelOpen: boolean;
  panelDirty: boolean;

  /** Pass straight to each panel's `onDirtyChange`. */
  setPanelDirty: (dirty: boolean) => void;

  /** Row "Edit"/"Expand", or clicking another row while one is focused. */
  focusItem: (id: number) => void;
  toggleSelectMode: () => void;
  toggleSelected: (id: number) => void;
  /** Header "select all" checkbox, over the currently visible ids. */
  toggleSelectAll: (ids: number[], checked: boolean) => void;
  /** SelectionBar's "Edit" — the only thing that opens the mass panel. */
  openMassPanel: () => void;

  clearFocus: () => void;
  clearSelection: () => void;
  /** Drop a deleted/removed row out of whichever state still points at it. */
  forgetItem: (id: number) => void;
  /**
   * Start a caller-owned flow that owns the panel but has no row behind it
   * (Events' "new event" draft). Blocked while dirty and clears focus +
   * selection first, so it can't silently replace an in-progress edit.
   */
  startExternalFlow: (start: () => void) => void;

  getPrevNext: <T>(items: T[], getId: (item: T) => number) => PrevNext;
}

export interface PrevNext {
  /** Index of the focused row in `items`, or -1 (not focused / filtered out). */
  index: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevId: number | null;
  nextId: number | null;
}

export interface PanelSelectionOptions {
  /**
   * Called whenever this hook takes over the panel (focusing a row, entering
   * select mode) so a caller-owned flow with no row behind it — Events'
   * "creating a new event" draft — gets dropped at the same time. Members has
   * no such flow, so it omits this.
   */
  onClearExternal?: () => void;
  /**
   * Which row's panel is open on first render — for a page that keeps the
   * open panel in its URL, so a refresh comes back to it. Read once; the
   * hook owns it from then on.
   */
  initialFocusedId?: number | null;
}

export function usePanelSelection(options: PanelSelectionOptions = {}): PanelSelection {
  const [focusedId, setFocusedId] = useState<number | null>(options.initialFocusedId ?? null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [massPanelOpen, setMassPanelOpen] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);

  // Read through a ref so the actions below keep stable identities even when
  // the caller hands in a fresh closure each render — several of them end up
  // in a setPanel effect's dependency list, where a new identity per render
  // would re-register the panel in a loop.
  const clearExternalRef = useRef(options.onClearExternal);
  useEffect(() => { clearExternalRef.current = options.onClearExternal; });

  const clearFocus = useCallback(() => {
    setFocusedId(null);
    setPanelDirty(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
    setMassPanelOpen(false);
    setPanelDirty(false);
  }, []);

  const toggleSelectMode = useCallback(() => {
    if (panelDirty) return;
    if (selectMode) {
      clearSelection();
      return;
    }
    // Carries whatever was open into the new mode instead of discarding it:
    // a focused row becomes the pre-checked row, and its panel stays open
    // (massPanelOpen true) rather than dropping back to the SelectionBar —
    // there's already a panel showing it, no reason to close it just to make
    // you press Edit again. A caller-owned draft (only reachable here while
    // clean, since a dirty one is blocked above) is simply dropped.
    clearExternalRef.current?.();
    if (focusedId !== null) {
      setSelectedIds(new Set([focusedId]));
      setFocusedId(null);
      setMassPanelOpen(true);
    }
    setSelectMode(true);
  }, [panelDirty, selectMode, focusedId, clearSelection]);

  // Unchecking back down to zero while the mass panel is open closes it —
  // there's nothing left to edit — but leaves Select mode itself on, so the
  // SelectionBar reappears instead of exiting selection entirely. Applied at
  // every point the selection can shrink rather than in an effect watching
  // it, which would cost an extra render pass.
  const applySelection = useCallback((next: Set<number>) => {
    setSelectedIds(next);
    if (next.size === 0) setMassPanelOpen(false);
  }, []);

  const toggleSelected = useCallback((id: number) => {
    if (panelDirty) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    applySelection(next);
  }, [panelDirty, selectedIds, applySelection]);

  const toggleSelectAll = useCallback((ids: number[], checked: boolean) => {
    const next = new Set(selectedIds);
    ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    applySelection(next);
  }, [selectedIds, applySelection]);

  // Always lands in plain single-focus mode — it never turns Select mode on,
  // and drops out of it (or out of a caller-owned draft) if either was
  // already active, replacing whichever panel was open.
  const focusItem = useCallback((id: number) => {
    if (panelDirty) return;
    clearExternalRef.current?.();
    setSelectMode(false);
    setSelectedIds(new Set());
    setMassPanelOpen(false);
    setFocusedId(id);
  }, [panelDirty]);

  const openMassPanel = useCallback(() => setMassPanelOpen(true), []);

  const startExternalFlow = useCallback((start: () => void) => {
    if (panelDirty) return;
    clearFocus();
    clearSelection();
    start();
  }, [panelDirty, clearFocus, clearSelection]);

  // Otherwise a deleted-but-still-selected/focused row would keep a panel
  // open against a row that no longer exists.
  const forgetItem = useCallback((id: number) => {
    if (selectedIds.has(id)) {
      const next = new Set(selectedIds);
      next.delete(id);
      applySelection(next);
    }
    setFocusedId((prev) => (prev === id ? null : prev));
  }, [selectedIds, applySelection]);

  // Prev/next only make sense for the plain single-focus flow (not while
  // mass-editing several at once) and step through the caller's own current
  // filter/sort order, so switching sort or narrowing a filter mid-edit still
  // lands somewhere sensible. Returns plain ids/booleans rather than
  // callbacks so callers can put them in a dependency array without
  // re-registering their panel every render.
  const getPrevNext = useCallback(<T,>(items: T[], getId: (item: T) => number): PrevNext => {
    const index = focusedId !== null ? items.findIndex((item) => getId(item) === focusedId) : -1;
    const hasPrev = !panelDirty && index > 0;
    const hasNext = !panelDirty && index !== -1 && index < items.length - 1;
    return {
      index,
      hasPrev,
      hasNext,
      prevId: hasPrev ? getId(items[index - 1]) : null,
      nextId: hasNext ? getId(items[index + 1]) : null,
    };
  }, [focusedId, panelDirty]);

  return {
    focusedId, selectMode, selectedIds, massPanelOpen, panelDirty,
    setPanelDirty,
    focusItem, toggleSelectMode, toggleSelected, toggleSelectAll, openMassPanel,
    clearFocus, clearSelection, forgetItem, startExternalFlow,
    getPrevNext,
  };
}
