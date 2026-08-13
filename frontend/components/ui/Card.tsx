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

  return (
    <div
      onMouseEnter={(e) => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeave?.(e); }}
      style={{
        background: variant === "danger" ? "var(--color-danger-subtle)" : "var(--color-surface)",
        border: `1px solid ${resolvedBorder}`,
        borderRadius: radius === "lg" ? "var(--radius-lg)" : "var(--radius-md)",
        boxShadow: shadow ? (hoverable && hovered ? "var(--shadow-md)" : "var(--shadow-sm)") : undefined,
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
