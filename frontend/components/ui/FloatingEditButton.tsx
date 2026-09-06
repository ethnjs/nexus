"use client";

import Link from "next/link";
import { IconEdit } from "@/components/ui/Icons";

interface FloatingEditButtonProps {
  /** Where editing happens — this page's own edit route. */
  href: string;
  title?: string;
}

// The "edit what you're looking at" affordance for a whole page, as opposed
// to a control for one field: a record you read top to bottom has no single
// place a header button belongs, so it sits over the page instead.
export function FloatingEditButton({ href, title = "Edit" }: FloatingEditButtonProps) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      style={{
        position: "fixed", bottom: "32px", right: "32px",
        width: "52px", height: "52px", borderRadius: "50%",
        background: "var(--color-accent)", color: "var(--color-text-inverse)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "var(--shadow-lg)", textDecoration: "none",
        transition: "transform 0.15s ease",
        zIndex: 50,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      <IconEdit size={20} />
    </Link>
  );
}
