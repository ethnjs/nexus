"use client";

import { ReactNode } from "react";

/** A circular completed/total meter. `children` render centered over the ring
 *  (a big label at dashboard size); a small ring usually takes none and puts
 *  its label beside it instead. */
export function ProgressRing({
  completed,
  total,
  size,
  strokeWidth = 8,
  color = "var(--color-accent)",
  children,
}: {
  completed: number;
  total: number;
  size: number;
  /** In viewBox units (the viewBox is 100 wide), so it scales with `size` —
   *  a small ring needs a proportionally thicker stroke to stay visible. */
  strokeWidth?: number;
  color?: string;
  children?: ReactNode;
}) {
  const pct = total > 0 ? Math.min(completed / total, 1) : 0;
  const radius = 50 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      role="progressbar"
      aria-valuenow={completed}
      aria-valuemin={0}
      aria-valuemax={total}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--color-accent-subtle)" strokeWidth={strokeWidth} />
        <circle
          cx={50}
          cy={50}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{ transition: "stroke-dashoffset 200ms ease" }}
        />
      </svg>
      {children && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
