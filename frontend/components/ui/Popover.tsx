"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

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
}

// Generic click-to-open panel of selectable items, anchored to a trigger —
// outside-click closes it, selecting an item runs onSelect and closes on
// success, shows the error and stays open on failure. Content-agnostic:
// callers supply the items, key, label, and select handler.
export function Popover<T>({
  trigger, items, getKey, renderLabel, onSelect, emptyMessage = "Nothing to show", width = 180, align = "right",
}: PopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

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
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingKey(null);
    }
  }

  const busy = pendingKey !== null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", [align]: 0, zIndex: 50,
          width: `${width}px`, maxHeight: "260px", overflowY: "auto", padding: "6px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {items.length === 0 ? (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", padding: "6px 10px" }}>
              {emptyMessage}
            </p>
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
