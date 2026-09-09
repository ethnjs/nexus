"use client";

import { ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { IconX, IconChevronLeft, IconChevronRight } from "@/components/ui/Icons";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";

interface DockedPanelProps {
  /** Omit for a panel that is always open — no close button, and Escape does
   *  nothing. A panel the page cannot function without should not offer a
   *  control that leaves the page in a state it can't use. */
  onClose?: () => void;
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
  /** Controls in the header immediately left of the close button — for actions that configure the panel itself, which belong to the panel rather than to the page behind it. */
  headerActions?: ReactNode;
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
  onClose, children, width = 480, footer, headerActions, onPrev, onNext, prevDisabled, nextDisabled,
}: DockedPanelProps) {
  const showNav = onPrev !== undefined || onNext !== undefined;
  useEffect(() => {
    if (!onClose) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
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
        // No shadow. This panel takes horizontal space rather than covering
        // anything, so there is no depth for one to describe — and with two
        // docked side by side it only ever landed on the neighbour. The
        // borderLeft above is the separation.
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
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {headerActions}
          {onClose && (
            <Button type="button" variant="secondary" size="sm" iconOnly onClick={onClose} title="Close">
              <IconX size={13} />
            </Button>
          )}
        </div>
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
