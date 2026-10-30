"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { IconChevronRight } from "@/components/ui/Icons";

type CompoundButtonProps = Omit<ComponentProps<typeof Button>, "iconOnly" | "size"> & {
  /** Before the text, e.g. an icon from Icons.tsx. */
  icon?: ReactNode;
  /** A smaller line under the label saying what the button does. */
  description: ReactNode;
};

/**
 * A full-width button with its label over a line of description, an icon
 * before and a chevron after — for picking one of a few ways forward, as in
 * Fluent UI's CompoundButton. A Button underneath, so it keeps the variants,
 * hover and focus every other button has.
 */
export function CompoundButton({
  icon,
  description,
  children,
  variant = "secondary",
  type = "button",
  style,
  ...props
}: CompoundButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      size="md"
      fullWidth
      style={{
        height: "auto",
        padding: "14px 16px",
        justifyContent: "flex-start",
        gap: "12px",
        ...style,
      }}
      {...props}
    >
      {icon && (
        <span style={{ display: "flex", color: "var(--color-text-secondary)" }}>{icon}</span>
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600 }}>{children}</span>
        <span style={{ fontSize: "12px", fontWeight: 400, color: "var(--color-text-secondary)" }}>
          {description}
        </span>
      </span>
      <IconChevronRight size={14} style={{ color: "var(--color-text-tertiary)" }} />
    </Button>
  );
}
