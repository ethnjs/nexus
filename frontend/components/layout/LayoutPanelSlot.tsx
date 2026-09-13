"use client";

import { useEffect, useState } from "react";
import { LayoutPanel, useLayoutPanelContent } from "@/lib/useLayoutPanel";

// Renders whatever a descendant registered via useSetLayoutPanel as a sibling
// of the Topbar+main column, so it consumes layout width instead of covering
// the page.
//
// mounted lags behind panel on close (stays mounted through the collapse
// transition instead of vanishing instantly); expanded flips a frame after
// mount so there's an actual 0 -> full-width transition to animate rather
// than appearing already-open. Same technique as the shifts page's split-view
// panel (panelMountedId/panelExpanded there).
export function LayoutPanelSlot() {
  const panel = useLayoutPanelContent();
  const isOpen = panel !== null;

  const [mounted, setMounted] = useState<LayoutPanel | null>(panel);
  const [armed, setArmed] = useState(false);
  const [prev, setPrev] = useState<LayoutPanel | null>(panel);

  // React's "adjust state during render" pattern rather than an effect: this
  // is derived state, and an effect would cost an extra render pass on every
  // registration.
  //
  // Content follows every registration, but the open animation only re-arms
  // when the panel actually goes from absent to present. A registered panel is
  // rebuilt whenever the page it came from re-renders (Members re-registers on
  // every member-list change), and re-arming on that would restart the slide
  // mid-flight.
  if (panel !== prev) {
    const wasOpen = prev !== null;
    setPrev(panel);
    if (panel) setMounted(panel);
    if (isOpen !== wasOpen) setArmed(false);
  }

  // Derived, not stored, so closing drops it to 0 in the same render the panel
  // is unregistered — no effect needed for the close half.
  const expanded = isOpen && armed;

  useEffect(() => {
    if (!isOpen) return;
    // A single rAF often fires before the browser has actually painted
    // the just-mounted width:0 state, so the width:full flip lands in the
    // same paint and there's nothing to visibly transition from. Nesting
    // a second rAF guarantees one real paint happens in between.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div
      onTransitionEnd={() => { if (!expanded) setMounted(null); }}
      style={{
        width: expanded ? mounted.width : 0,
        opacity: expanded ? 1 : 0,
        flexShrink: 0, overflow: "hidden", height: "100%",
        // Same 220ms/ease as the members table's grid-template-columns
        // transition, so the table's Roles column collapses in lockstep with
        // this sliding open rather than finishing 20ms early.
        transition: "width 220ms ease, opacity 220ms ease",
      }}
    >
      <div style={{ width: mounted.width, height: "100%" }}>
        {mounted.content}
      </div>
    </div>
  );
}
