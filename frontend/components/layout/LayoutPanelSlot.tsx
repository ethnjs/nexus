"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { type LayoutPanelPart, useLayoutPanelContent } from "@/lib/useLayoutPanel";

const TRANSITION = "width 220ms ease, opacity 220ms ease";

// mounted lags behind part on close so it stays through the collapse
// transition; armed flips a frame after mount so there's a real 0 -> full
// width transition to animate.
function useSlide(part: LayoutPanelPart | null) {
  const isOpen = part !== null;
  const [mounted, setMounted] = useState<LayoutPanelPart | null>(part);
  const [armed, setArmed] = useState(false);
  const [prev, setPrev] = useState<LayoutPanelPart | null>(part);

  // Content follows every registration, but the slide only re-arms when the
  // part goes from absent to present: pages re-register on every re-render,
  // and re-arming then would restart the slide mid-flight.
  if (part !== prev) {
    setPrev(part);
    if (part) setMounted(part);
    if (isOpen !== (prev !== null)) setArmed(false);
  }

  const expanded = isOpen && armed;

  useEffect(() => {
    if (!isOpen) return;
    // One rAF can land before the width:0 state is painted, leaving nothing
    // to transition from; the second guarantees a paint in between.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isOpen]);

  const width = expanded && mounted ? mounted.width : 0;
  const onTransitionEnd = () => {
    if (!expanded) setMounted(null);
  };
  return { mounted, expanded, width, onTransitionEnd };
}

// Rendered as the last flex sibling of the Topbar+main column. The docked part
// takes width from the column; the floating part covers the column's right
// edge, flush against the docked part.
export function LayoutPanelSlot() {
  const panel = useLayoutPanelContent();
  const docked = useSlide(panel?.docked ?? null);
  const floating = useSlide(panel?.floating ?? null);

  // Lets page-level fixed bars (SelectionBar) center on the uncovered page.
  const covered = docked.width + floating.width;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--layout-panel-covered", `${covered}px`);
    return () => {
      root.style.removeProperty("--layout-panel-covered");
    };
  }, [covered]);

  if (!docked.mounted && !floating.mounted) return null;

  return (
    <div
      style={
        {
          position: "relative",
          flexShrink: 0,
          height: "100%",
          "--layout-panel-covered": "0px",
        } as CSSProperties
      }
    >
      {docked.mounted && (
        <div
          onTransitionEnd={docked.onTransitionEnd}
          style={{
            width: docked.width,
            opacity: docked.expanded ? 1 : 0,
            overflow: "hidden",
            height: "100%",
            transition: TRANSITION,
          }}
        >
          <div style={{ width: docked.mounted.width, height: "100%" }}>
            {docked.mounted.content}
          </div>
        </div>
      )}
      {floating.mounted && (
        <div
          data-floating-panel
          onTransitionEnd={floating.onTransitionEnd}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: "100%",
            width: floating.width,
            opacity: floating.expanded ? 1 : 0,
            overflow: "hidden",
            boxShadow: "var(--shadow-lg)",
            // Under the fixed action bars (60) and modals.
            zIndex: 50,
            transition: TRANSITION,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: floating.mounted.width,
              height: "100%",
            }}
          >
            {floating.mounted.content}
          </div>
        </div>
      )}
    </div>
  );
}
