"use client";

import { CSSProperties, ReactNode, useState } from "react";

interface HoverCardProps {
  /** Rich content shown in the popover — unlike Tooltip, not limited to a plain string. */
  content: ReactNode;
  children: ReactNode;
  width?: number;
  /** Merged onto the trigger wrapper — e.g. justifyContent to center the trigger within a stretched grid cell. */
  style?: CSSProperties;
}

// Hover-triggered popover for compact rows that need more detail than fits
// inline (e.g. a creator's email + roles). Tooltip covers the plain-string,
// status/variant-icon case; this covers arbitrary JSX content.
export function HoverCard({ content, children, width = 220, style }: HoverCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", display: "inline-flex", minWidth: 0, ...style }}
    >
      {children}
      {hovered && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          zIndex: 20, width: `${width}px`, padding: "10px 12px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
