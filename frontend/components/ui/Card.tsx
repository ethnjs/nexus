"use client";

import { HTMLAttributes, useState } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  radius?:      "md" | "lg";
  shadow?:      boolean;
  hoverable?:   boolean;
  borderColor?: string;
  variant?:     "normal" | "danger";
}

export function Card({
  radius = "md",
  shadow = true,
  hoverable = false,
  borderColor,
  variant = "normal",
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...props
}: CardProps) {
  const [hovered, setHovered] = useState(false);

  const resolvedBorder =
    borderColor ??
    (variant === "danger" ? "var(--color-danger)" : hoverable && hovered ? "var(--color-border-strong)" : "var(--color-border)");

  const outerShadow = shadow ? (hoverable && hovered ? "var(--shadow-md)" : "var(--shadow-sm)") : undefined;
  // An inset shadow hugs the element's own box (rectangular corners and all),
  // unlike radial-gradient which is always circular/elliptical regardless of
  // shape — so this is what actually reads as "darker at the (square) edges,
  // white toward the center" instead of a circular vignette.
  const dangerVignette = "inset 0 0 28px 6px var(--color-danger-subtle)";

  return (
    <div
      onMouseEnter={(e) => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeave?.(e); }}
      style={{
        background: "var(--color-surface)",
        border: `1px solid ${resolvedBorder}`,
        borderRadius: radius === "lg" ? "var(--radius-lg)" : "var(--radius-md)",
        boxShadow: variant === "danger"
          ? outerShadow ? `${dangerVignette}, ${outerShadow}` : dangerVignette
          : outerShadow,
        cursor: hoverable ? "pointer" : undefined,
        transition: "border-color 120ms ease, box-shadow 120ms ease",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
