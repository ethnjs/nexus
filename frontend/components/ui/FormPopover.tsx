"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

interface FormPopoverProps {
  /** The element that toggles the panel — an icon button, a chip, whatever. */
  trigger: ReactNode;
  /** Panel content; receives a close() callback so the form can dismiss itself after a successful submit. */
  children: (close: () => void) => ReactNode;
  width?: number;
  /** Which side of the trigger the panel hangs from. */
  align?: "left" | "right";
}

type PanelPos = { top: number; left: number };

const PANEL_GAP = 6;

// Click-to-open positioned panel for arbitrary form content, anchored to a
// trigger — outside-click closes it. Sibling to Popover (which is
// specialized for item lists/checklists): this one is content-agnostic so
// it can host a small create/edit form instead. Position logic mirrors
// Popover's own (fixed, computed from the trigger's bounding rect so it
// isn't clipped by a scrollable ancestor like a side panel).
export function FormPopover({ trigger, children, width = 260, align = "right" }: FormPopoverProps) {
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)}>{trigger}</div>

      {open && panelPos && (
        <div style={{
          position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 300,
          width: `${width}px`, boxSizing: "border-box", padding: "12px 16px 14px 12px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
