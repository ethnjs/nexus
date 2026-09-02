"use client";

import { MouseEvent as ReactMouseEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { IconLock } from "@/components/ui/Icons";

interface PopoverProps<T> {
  /** The element that toggles the panel — an icon button, a chip, whatever. */
  trigger: ReactNode;
  items: T[];
  getKey: (item: T) => string | number;
  renderLabel: (item: T) => ReactNode;
  /** May throw/reject — the popover shows the error inline and stays open. */
  onSelect: (item: T) => void | Promise<void>;
  emptyMessage?: string;
  width?: number;
  /** Which side of the trigger the panel hangs from. */
  align?: "left" | "right";
  /** Checklist mode: rows render as a checkbox + label (like a picker list), stay open across selections instead of closing after each one. Requires isSelected. */
  checklist?: boolean;
  isSelected?: (item: T) => boolean;
  /** Rows for which this returns true can't be selected (e.g. a role the actor isn't allowed to touch, or a delete blocked by existing data) but stay visible rather than being filtered out. In checklist mode they show a lock icon instead of a checkbox; in list mode they render inert with a tooltip. */
  isDisabled?: (item: T) => boolean;
  /** Tooltip text for a disabled row. Only consulted when isDisabled(item) is true; a falsy return skips the tooltip. */
  disabledReason?: (item: T) => string | undefined;
  /** Fires whenever the panel opens/closes — e.g. to rotate a chevron on the trigger. */
  onOpenChange?: (open: boolean) => void;
  /** Shows a search field at the top of the panel (focused on open) that narrows the rows. Requires getSearchText. For lists long enough that scrolling to find a row is the slow part — a tournament's events, a member's experience. */
  searchable?: boolean;
  /** The text `searchable` matches a row against — usually the same string renderLabel shows. */
  getSearchText?: (item: T) => string;
  /** Rendered above the rows and outside their scroll container — for a control that acts on the list as a whole, e.g. a select-all toggle. */
  header?: ReactNode;
}

// Anchored from the top (below the trigger) normally; flips to bottom
// (above the trigger) when there isn't room underneath.
type PanelPos = { left: number } & ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined });
type HoverTip = { text: string; top: number; left: number };

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 260;

// Generic click-to-open panel of selectable items, anchored to a trigger —
// outside-click closes it. In default "list" mode, selecting an item runs
// onSelect and closes on success (shows the error and stays open on
// failure). In "checklist" mode, rows show a checkbox and the panel stays
// open across selections so multiple items can be toggled in one visit.
// Content-agnostic: callers supply the items, key, label, and select handler.
//
// The panel is position: fixed, computed from the trigger's own bounding
// rect (same approach as Dropdown) rather than position: absolute anchored
// to a relative wrapper — a wrapper-relative panel gets clipped by any
// scrollable/overflow:hidden ancestor between it and the viewport (e.g. a
// side panel's scroll container), which silently truncates or hides it.
export function Popover<T>({
  trigger, items, getKey, renderLabel, onSelect, emptyMessage = "Nothing to show", width = 180, align = "right",
  checklist = false, isSelected, isDisabled, disabledReason, onOpenChange, searchable = false, getSearchText, header,
}: PopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [pendingKey, setPendingKey] = useState<string | number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Fixed-position, computed from the row's own bounding rect on hover —
  // a Tooltip anchored via position:absolute to a wrapper nested inside
  // this panel's own overflow:auto/scrolling list runs into the exact
  // clipping/stacking problem the panel itself already had to work around
  // (see the file-level comment on Popover): it renders underneath later
  // sibling rows instead of floating above them.
  function showHoverTip(e: ReactMouseEvent<HTMLElement>, text: string) {
    const r = e.currentTarget.getBoundingClientRect();
    setHoverTip({ text, top: r.top - 8, left: r.left + r.width / 2 });
  }

  function updatePanelPos() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = align === "right" ? r.right - width : r.left;
    // Flip above the trigger when there isn't enough room below for even a
    // capped-height panel, but only if there's actually more room above —
    // otherwise a trigger near the very top of the viewport would flip into
    // even less space than it started with.
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const flip = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP && spaceAbove > spaceBelow;
    setPanelPos(flip
      ? { bottom: window.innerHeight - r.top + PANEL_GAP, left }
      : { top: r.bottom + PANEL_GAP, left });
  }

  useEffect(() => {
    if (!open) { setPanelPos(null); setHoverTip(null); setQuery(""); return; }
    updatePanelPos();
    window.addEventListener("scroll", updatePanelPos, true);
    window.addEventListener("resize", updatePanelPos);
    return () => {
      window.removeEventListener("scroll", updatePanelPos, true);
      window.removeEventListener("resize", updatePanelPos);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleSelect(item: T) {
    setError(undefined);
    const key = getKey(item);
    setPendingKey(key);
    try {
      await onSelect(item);
      if (!checklist) setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingKey(null);
    }
  }

  const busy = pendingKey !== null;
  const needle = query.trim().toLowerCase();
  const visibleItems = searchable && needle
    ? items.filter((item) => (getSearchText?.(item) ?? "").toLowerCase().includes(needle))
    : items;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)}>{trigger}</div>

      {open && panelPos && (
        <div style={{
          position: "fixed",
          ...(panelPos.top !== undefined ? { top: panelPos.top } : { bottom: panelPos.bottom }),
          left: panelPos.left, zIndex: 300,
          width: `${width}px`, padding: "6px", boxSizing: "border-box",
          display: "flex", flexDirection: "column", overflow: "hidden",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {searchable && (
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              // Focused on mount rather than through an effect: the panel
              // only renders once its position is measured, so a focus()
              // fired when `open` flips runs before the input exists.
              autoFocus
              style={{
                flexShrink: 0,
                width: "100%", height: "26px", marginBottom: "6px",
                padding: "0 8px", boxSizing: "border-box",
                fontFamily: "var(--font-sans)", fontSize: "12px",
                color: "var(--color-text-primary)", background: "var(--color-bg)",
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
                outline: "none",
              }}
            />
          )}
          {header && <div style={{ flexShrink: 0, marginBottom: "6px" }}>{header}</div>}
          {/* The rows scroll, the search box above them doesn't — a sticky
              box inside the scroller leaves rows sliding through the gap
              between it and the panel's padded edge. */}
          <div style={{ maxHeight: `${PANEL_MAX_HEIGHT}px`, overflowY: "auto" }}>
          {visibleItems.length === 0 ? (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", padding: "6px 10px" }}>
              {needle ? "No matches" : emptyMessage}
            </p>
          ) : checklist ? (
            visibleItems.map((item) => {
              const key = getKey(item);
              const checked = isSelected?.(item) ?? false;
              const disabled = isDisabled?.(item) ?? false;
              const reason = disabled ? disabledReason?.(item) : undefined;
              return (
                <label
                  key={key}
                  onMouseEnter={reason ? (e) => showHoverTip(e, reason) : undefined}
                  onMouseLeave={reason ? () => setHoverTip(null) : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "6px 8px", borderRadius: "var(--radius-sm)",
                    cursor: disabled || busy ? "not-allowed" : "pointer",
                    background: checked ? "var(--color-accent-subtle)" : "transparent",
                    opacity: disabled ? 0.5 : busy && pendingKey !== key ? 0.5 : 1,
                  }}
                >
                  {disabled ? (
                    <IconLock size={13} style={{ flexShrink: 0, color: "var(--color-text-tertiary)" }} />
                  ) : (
                    <Checkbox checked={checked} locked={busy} onChange={() => handleSelect(item)} />
                  )}
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
                    {renderLabel(item)}
                  </span>
                </label>
              );
            })
          ) : (
            visibleItems.map((item) => {
              const key = getKey(item);
              const disabled = isDisabled?.(item) ?? false;
              const reason = disabled ? disabledReason?.(item) : undefined;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--color-bg)"; if (reason) showHoverTip(e, reason); }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; if (reason) setHoverTip(null); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 10px", border: "none", background: "transparent",
                    fontFamily: "var(--font-sans)", fontSize: "13px",
                    color: "var(--color-text-primary)", borderRadius: "var(--radius-sm)",
                    cursor: busy || disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : busy && pendingKey !== key ? 0.5 : 1,
                  }}
                >
                  {renderLabel(item)}
                </button>
              );
            })
          )}
          </div>
          {error && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", padding: "4px 10px 2px" }}>
              {error}
            </p>
          )}
        </div>
      )}

      {hoverTip && (
        <div style={{
          position: "fixed", top: hoverTip.top, left: hoverTip.left, zIndex: 400,
          transform: "translate(-50%, -100%)", maxWidth: "220px",
          padding: "7px 11px", borderRadius: "var(--radius-md)",
          background: "var(--color-surface)", boxShadow: "var(--shadow-lg)",
          fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)",
          pointerEvents: "none",
        }}>
          {hoverTip.text}
        </div>
      )}
    </div>
  );
}
