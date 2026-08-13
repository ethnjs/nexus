"use client";

import { CSSProperties, ReactNode, useRef, useState } from "react";

interface HoverCardProps {
  /** Rich content shown in the popover — unlike Tooltip, not limited to a plain string. */
  content: ReactNode;
  children: ReactNode;
  width?: number;
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
          zIndex: 400, width: `${width}px`, padding: "10px 12px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
