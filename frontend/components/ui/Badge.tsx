"use client";

import { type HTMLAttributes, type MouseEvent, useState } from "react";

type BadgeVariant =
  | "default"
  | "interested"
  | "confirmed"
  | "declined"
  | "pending"
  | "assigned"
  | "removed"
  | "admin"
  | "td"
  | "warning"
  | "divisionA"
  | "divisionB"
  | "divisionC";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** When set, clicking the badge copies this value to the clipboard and flashes a "Copied!" tag. */
  copyValue?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-accent-subtle text-secondary border-border",
  interested: "bg-accent-subtle text-secondary border-border",
  confirmed: "bg-success-subtle text-success border-success/20",
  declined: "bg-danger-subtle text-danger border-danger/20",
  // Nothing recorded yet — reads as absent rather than as an outcome, so it
  // stays muted instead of taking a status colour.
  pending: "bg-accent-subtle text-tertiary border-border",
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  removed: "bg-accent-subtle text-tertiary border-border",
  admin: "bg-accent text-inverse border-accent",
  td: "bg-accent-subtle text-primary border-border-strong",
  warning: "bg-warning-subtle text-warning border-warning/20",
  divisionA: "bg-division-a-subtle text-division-a border-division-a/20",
  divisionB: "bg-division-b-subtle text-division-b border-division-b/20",
  divisionC: "bg-division-c-subtle text-division-c border-division-c/20",
};

export function Badge({
  variant = "default",
  className = "",
  children,
  copyValue,
  onClick,
  style,
  ...props
}: BadgeProps) {
  const [copiedAt, setCopiedAt] = useState<{ top: number; left: number } | null>(null);

  async function handleClick(e: MouseEvent<HTMLSpanElement>) {
    // Copying is a self-contained action — don't let it also trigger
    // whatever a clickable ancestor (e.g. an expandable row) does.
    e.stopPropagation();
    onClick?.(e);
    if (!copyValue) return;
    const rect = e.currentTarget.getBoundingClientRect();
    await navigator.clipboard.writeText(copyValue);
    setCopiedAt({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
    setTimeout(() => setCopiedAt(null), 1500);
  }

  return (
    <span
      onClick={copyValue ? handleClick : onClick}
      className={[
        "inline-flex items-center px-2 py-0.5",
        // Its own font, not the parent's — inherited, a badge in a Button
        // drew in sans beside its mono siblings.
        "font-mono text-2xs font-medium uppercase tracking-wider",
        "border rounded-sm",
        variantStyles[variant],
        className,
      ].join(" ")}
      style={copyValue ? { cursor: "pointer", ...style } : style}
      {...props}
    >
      {children}
      {copiedAt && (
        // Fixed, not absolute, so a table's overflow clipping can't hide it.
        <span
          style={{
            position: "fixed",
            top: copiedAt.top,
            left: copiedAt.left,
            transform: "translateX(-50%)",
            padding: "3px 8px",
            borderRadius: "var(--radius-sm)",
            whiteSpace: "nowrap",
            background: "var(--color-text-primary)",
            color: "var(--color-text-inverse)",
            fontFamily: "var(--font-sans)",
            fontSize: "11px",
            fontWeight: 500,
            textTransform: "none",
            letterSpacing: "normal",
            zIndex: 10,
          }}
        >
          Copied!
        </span>
      )}
    </span>
  );
}
