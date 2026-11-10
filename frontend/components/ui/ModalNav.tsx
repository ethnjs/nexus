"use client";

import { Button } from "@/components/ui/Button";

// The left-column nav of a two-pane modal (Export, Form flow): an uppercase
// group heading and full-width items, the active one tinted.

export function NavHeading({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "10px 10px 4px",
        fontFamily: "var(--font-sans)",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}
    >
      {children}
    </span>
  );
}

export function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      fullWidth
      onClick={onClick}
      style={{
        justifyContent: "flex-start",
        fontWeight: active ? 600 : 500,
        // Longhand: Button's hover sets backgroundColor, and React warns when
        // a shorthand and its longhand mix on one element.
        backgroundColor: active ? "var(--color-accent-subtle)" : undefined,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Button>
  );
}
