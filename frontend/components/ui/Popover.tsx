"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
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
  /** Checklist mode only: rows for which this returns true show a lock icon instead of a checkbox and can't be toggled (e.g. a role the actor isn't allowed to touch), but stay visible rather than being filtered out. */
  isDisabled?: (item: T) => boolean;
}

type PanelPos = { top: number; left: number };

const PANEL_GAP = 6;

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
  checklist = false, isSelected, isDisabled,
}: PopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  function updatePanelPos() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = align === "right" ? r.right - width : r.left;
    setPanelPos({ top: r.bottom + PANEL_GAP, left });
  }

  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)}>{trigger}</div>

      {open && panelPos && (
        <div style={{
          position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 300,
          width: `${width}px`, maxHeight: "260px", overflowY: "auto", padding: "6px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {items.length === 0 ? (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", padding: "6px 10px" }}>
              {emptyMessage}
            </p>
          ) : checklist ? (
            items.map((item) => {
              const key = getKey(item);
              const checked = isSelected?.(item) ?? false;
              const disabled = isDisabled?.(item) ?? false;
              return (
                <label
                  key={key}
                  title={disabled ? "You can't touch a role that outranks you" : undefined}
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
            items.map((item) => {
              const key = getKey(item);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy}
                  onClick={() => handleSelect(item)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 10px", border: "none", background: "transparent",
                    fontFamily: "var(--font-sans)", fontSize: "13px",
                    color: "var(--color-text-primary)", borderRadius: "var(--radius-sm)",
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy && pendingKey !== key ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {renderLabel(item)}
                </button>
              );
            })
          )}
          {error && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", padding: "4px 10px 2px" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
