"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

interface FormPopoverProps {
  /** The element that toggles the panel — an icon button, a chip, whatever. */
  trigger: ReactNode;
  /** Panel content; receives a close() callback so the form can dismiss itself after a successful submit. */
  children: (close: () => void) => ReactNode;
  width?: number;
  /** Which side of the trigger the panel hangs from. 'bottom' (default)
      drops the panel below the trigger, edge-aligned per `align`. 'right'
      flies it out to the trigger's right, top-aligned — e.g. a vertical
      icon rail where the panel should read as "belongs to this icon," not
      "dropped from it." Flips to the left of the trigger if there isn't
      room on the right. */
  side?: "bottom" | "right";
  /** 'bottom' side only — which side of the trigger the panel hangs from. */
  align?: "left" | "right";
  /** Controlled open state — e.g. forcing a field's key popover open when
      Save surfaces an error on it. Omit for plain click-to-toggle (the
      original behavior every existing caller still gets). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Default true. False keeps the panel open on an outside click — the
      trigger itself (or a controlled `open=false`) is the only way to close
      it — for a popover meant to stay open while the user works elsewhere
      on the page (e.g. editing the card the trigger belongs to). */
  closeOnOutsideClick?: boolean;
}

type PanelPos = { left: number } & ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined });

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 400;

// Click-to-open positioned panel for arbitrary form content, anchored to a
// trigger — outside-click closes it. Sibling to Popover (which is
// specialized for item lists/checklists): this one is content-agnostic so
// it can host a small create/edit form instead. Position logic mirrors
// Popover's own (fixed, computed from the trigger's bounding rect so it
// isn't clipped by a scrollable ancestor like a side panel; flips above the
// trigger when there's no room below).
export function FormPopover({
  trigger, children, width = 260, side = "bottom", align = "right",
  open: controlledOpen, onOpenChange, closeOnOutsideClick = true,
}: FormPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  function updatePanelPos() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();

    if (side === "right") {
      // Top-aligned with the trigger rather than dropped below it — this is
      // a "belongs to this icon" flyout, not a dropdown — and clamped so a
      // tall panel next to a trigger near the viewport's bottom doesn't run
      // off it. Flips to the trigger's left if there isn't room on the right.
      const spaceRight = window.innerWidth - r.right;
      const left = spaceRight < width + PANEL_GAP ? r.left - width - PANEL_GAP : r.right + PANEL_GAP;
      const top = Math.max(PANEL_GAP, Math.min(r.top, window.innerHeight - PANEL_MAX_HEIGHT - PANEL_GAP));
      setPanelPos({ top, left });
      return;
    }

    const left = align === "right" ? r.right - width : r.left;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const flip = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP && spaceAbove > spaceBelow;
    setPanelPos(flip
      ? { bottom: window.innerHeight - r.top + PANEL_GAP, left }
      : { top: r.bottom + PANEL_GAP, left });
  }

  // Tracks the trigger's position every frame rather than only on scroll/
  // resize — the trigger can also move because of a layout shift with no
  // window-level event of its own (e.g. a sibling field's height changing
  // as validation errors appear, or FloatingSaveBar's own height changing
  // and nudging surrounding layout). Cheap while a popover's actually open
  // (two getBoundingClientRect reads per frame), and it's the only way to
  // stay pinned regardless of *why* the trigger moved.
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    let raf: number;
    function loop() {
      updatePanelPos();
      raf = requestAnimationFrame(loop);
    }
    loop();
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnOutsideClick) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closeOnOutsideClick]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div ref={triggerRef} onClick={() => setOpen(!open)}>{trigger}</div>

      {open && panelPos && (
        <div style={{
          position: "fixed",
          ...(panelPos.top !== undefined ? { top: panelPos.top } : { bottom: panelPos.bottom }),
          left: panelPos.left, zIndex: 300,
          width: `${width}px`, maxHeight: `${PANEL_MAX_HEIGHT}px`, overflowY: "auto",
          boxSizing: "border-box", padding: "14px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
