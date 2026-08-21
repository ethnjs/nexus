"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

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

  // Only used to gate the panel's initial reveal (see the render below) —
  // the actual left/top/bottom values are written straight to the DOM in
  // updatePanelPos, not routed through this, so tracking a trigger that's
  // itself `position: sticky` (FieldToolbar) doesn't force a React re-render
  // of the whole panel subtree on every single scroll frame. That extra
  // reconciliation work was enough to make the panel visibly lag a frame or
  // two behind the trigger while scrolling — reading as the panel "sliding"
  // on its own instead of staying glued to the button.
  const [positioned, setPositioned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function updatePanelPos() {
    const el = panelRef.current;
    if (!triggerRef.current || !el) return;
    const r = triggerRef.current.getBoundingClientRect();
    const panelHeight = el.offsetHeight || PANEL_MAX_HEIGHT;

    let left: number;
    let top: number | undefined;
    let bottom: number | undefined;

    if (side === "right") {
      // Top-aligned with the trigger rather than dropped below it — this is
      // a "belongs to this icon" flyout, not a dropdown. Unclamped: it
      // tracks the trigger's real position exactly, including scrolling
      // past the viewport edge along with it if the trigger (itself
      // `position: sticky` in FieldToolbar) does — clamping it to stay
      // on-screen made it look glued to the viewport edge instead of to the
      // trigger once the trigger scrolled away. Flips to the trigger's left
      // if there isn't room on the right.
      const spaceRight = window.innerWidth - r.right;
      left = spaceRight < width + PANEL_GAP ? r.left - width - PANEL_GAP : r.right + PANEL_GAP;
      top = r.top;
    } else {
      left = align === "right" ? r.right - width : r.left;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const flip = spaceBelow < panelHeight + PANEL_GAP && spaceAbove > spaceBelow;
      if (flip) bottom = window.innerHeight - r.top + PANEL_GAP;
      else top = r.bottom + PANEL_GAP;
    }

    el.style.left = `${left}px`;
    el.style.top = top !== undefined ? `${top}px` : "";
    el.style.bottom = bottom !== undefined ? `${bottom}px` : "";
    el.style.visibility = "visible";
    setPositioned((prev) => (prev ? prev : true));
  }

  // Tracks the trigger's position every frame rather than only on scroll/
  // resize — the trigger can also move because of a layout shift with no
  // window-level event of its own (e.g. a sibling field's height changing
  // as validation errors appear, or FloatingSaveBar's own height changing
  // and nudging surrounding layout), and FieldToolbar's trigger specifically
  // is itself `position: sticky` so it can move continuously mid-scroll.
  // Cheap (two getBoundingClientRect reads and a direct style write per
  // frame, no React re-render) and it's the only way to stay pinned
  // regardless of *why* the trigger moved.
  //
  // useLayoutEffect (not useEffect) so the very first updatePanelPos() call
  // runs before the browser paints. The panel below is now mounted as soon
  // as `open` is true (rather than waiting on a computed position), so
  // panelRef.current already exists for this first call and it measures the
  // real height and writes the real position immediately — otherwise that
  // first frame would flash at the fallback spot and get corrected visibly
  // a moment later.
  useLayoutEffect(() => {
    if (!open) { setPositioned(false); return; }
    updatePanelPos();
    let raf: number;
    function loop() {
      raf = requestAnimationFrame(() => { updatePanelPos(); loop(); });
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

      {open && (
        <div ref={panelRef} style={{
          position: "fixed",
          // Mounted the instant `open` flips true, before a position is
          // known — the layout effect above measures this element and
          // writes its real position synchronously on that same first pass,
          // before the browser ever paints, so this fallback spot is never
          // actually visible. `positioned` just gates the reveal; the actual
          // left/top/bottom values from then on are written directly to
          // this element's style in updatePanelPos, not through React.
          ...(!positioned && { top: -9999, left: -9999, visibility: "hidden" as const }),
          zIndex: 300,
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
