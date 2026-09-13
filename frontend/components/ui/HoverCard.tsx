"use client";

import { CSSProperties, ReactNode, useRef, useState } from "react";

interface HoverCardProps {
  /** Rich content shown in the popover — unlike Tooltip, not limited to a plain string. */
  content: ReactNode;
  children: ReactNode;
  /**
   * Fixed px width, or "fit" to size the card to its content.
   *
   * Fixed is right when the content wraps and needs a predictable measure (a
   * stack of per-track rows). "fit" is right for a single line — a fixed
   * width wider than the text leaves it sitting off to one side of an
   * over-wide box, which reads as misaligned even though the box is centred.
   */
  width?: number | "fit";
  /** Merged onto the trigger wrapper — e.g. justifyContent to center the trigger within a stretched grid cell. */
  style?: CSSProperties;
}

type CardPos = { bottom: number; left: number };

// Hover-triggered popover for compact rows that need more detail than fits
// inline (e.g. a creator's email + roles). Tooltip covers the plain-string,
// status/variant-icon case; this covers arbitrary JSX content.
//
// The card is position: fixed, computed from the trigger's own bounding
// rect on hover — same reasoning as Popover's panel: a position: absolute
// card anchored to a relative wrapper gets clipped/painted-under by any
// scrollable ancestor between it and the viewport (e.g. a side panel's
// scroll container).
export function HoverCard({ content, children, width = 220, style }: HoverCardProps) {
  const [cardPos, setCardPos] = useState<CardPos | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  function handleEnter() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCardPos({ bottom: window.innerHeight - r.top + 6, left: r.left + r.width / 2 });
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setCardPos(null)}
      style={{ position: "relative", display: "inline-flex", minWidth: 0, ...style }}
    >
      {children}
      {cardPos && (
        <div style={{
          position: "fixed", bottom: cardPos.bottom, left: cardPos.left, transform: "translateX(-50%)",
          zIndex: 400, padding: "10px 12px",
          // max-content rather than fit-content: the card is position:fixed
          // with no containing block to fit *to*, so fit-content would
          // collapse toward zero instead of hugging the text.
          width: width === "fit" ? "max-content" : `${width}px`,
          // Even a "fit" card shouldn't run off a narrow viewport.
          maxWidth: width === "fit" ? "min(90vw, 420px)" : undefined,
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
