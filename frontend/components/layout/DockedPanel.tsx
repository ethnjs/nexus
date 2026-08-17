"use client";

import { ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { IconX, IconChevronLeft, IconChevronRight } from "@/components/ui/Icons";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";

interface DockedPanelProps {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /**
   * Rendered below the scrollable content, e.g. a FloatingSaveBar — scoped
   * to this panel's box (via a containing-block trick) so it centers on the
   * panel instead of the viewport. Deliberately narrow: only this slot gets
   * scoped, not all of `children` — anything else position:fixed inside
   * `children` (a Popover, a Modal) still needs real viewport coordinates,
   * since its own position math (getBoundingClientRect) is viewport-relative
   * and would land off-screen if it inherited this panel's box too.
   */
  footer?: ReactNode;
  /** Prev/next controls in the header, left of the close button — e.g. stepping through a table's current filtered/sorted order. Omit both to hide the controls entirely. */
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}

// Modal-free side panel: no portal, no backdrop, no overlay. It's meant to be rendered as a plain flex child of the app shell's
// top-level row (see useLayoutPanel), so it *takes* horizontal space rather
// than covering it — the page beside it stays fully interactive, which a
// modal overlay can't offer.
export function DockedPanel({
  onClose, children, width = 480, footer, onPrev, onNext, prevDisabled, nextDisabled,
}: DockedPanelProps) {
  const showNav = onPrev !== undefined || onNext !== undefined;
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        background: "var(--color-bg)",
        borderLeft: "1px solid var(--color-border)",
        // Fixed px (not 100%) so the content doesn't reflow while the slot
        // animates its width open/closed around it.
        width, flexShrink: 0,
        height: "100%",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      {/* Same height/background as Topbar so this strip's bottom border lines
          up with Topbar's and the two read as one continuous bar. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        height: `${TOPBAR_HEIGHT}px`, padding: "0 12px",
        background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)",
      }}>
        {showNav ? (
          <div style={{ display: "flex", gap: "4px" }}>
            <Button type="button" variant="secondary" size="sm" iconOnly disabled={!onPrev || prevDisabled} onClick={onPrev} title="Previous">
              <IconChevronLeft size={14} />
            </Button>
            <Button type="button" variant="secondary" size="sm" iconOnly disabled={!onNext || nextDisabled} onClick={onNext} title="Next">
              <IconChevronRight size={14} />
            </Button>
          </div>
        ) : <span />}
        <Button type="button" variant="secondary" size="sm" iconOnly onClick={onClose} title="Close">
          <IconX size={13} />
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {children}
      </div>
      {footer && (
        // Only this slot gets the containing-block trick — see the prop doc
        // above for why it can't be the whole panel.
        <div style={{ willChange: "transform" }}>
          {footer}
        </div>
      )}
    </div>
  );
}
