"use client";

import { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "@/components/ui/Card";

/** Exported for cards that size themselves for the overview's mosaic. */
export const OVERVIEW_CARD_PADDING = 16;

interface OverviewCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: string;
  /** Overrides the standard title — for the one card that isn't standard. */
  titleStyle?: CSSProperties;
  /** Muted beside the title — a count, say. */
  meta?: ReactNode;
  /** Right-aligned in the header: a badge or a small button. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Every overview widget's shell, so their headers match. The header holds a
 * small button's height even without one, so a row of cards lines up.
 */
export function OverviewCard({ title, titleStyle, meta, action, children, style, ...props }: OverviewCardProps) {
  return (
    <Card
      radius="lg"
      style={{ padding: `${OVERVIEW_CARD_PADDING}px`, display: "flex", flexDirection: "column", gap: "16px", ...style }}
      {...props}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "28px" }}>
        <span style={{
          minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)",
          ...titleStyle,
        }}>
          {title}
        </span>
        {meta !== undefined && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            {meta}
          </span>
        )}
        {action && <div style={{ marginLeft: "auto", flexShrink: 0 }}>{action}</div>}
      </div>
      {children}
    </Card>
  );
}
