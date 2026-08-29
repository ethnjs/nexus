"use client";

import { Badge } from "@/components/ui/Badge";

interface AgeFlagsBadgesProps {
  isOver18: boolean | null;
  isOver21: boolean | null;
}

// Content only, no PanelField wrapper — callers decide the label/layout
// around it (MemberPanel embeds this inside its "Membership" card's grid;
// the profile page may want its own placement).
export function AgeFlagsBadges({ isOver18, isOver21 }: AgeFlagsBadgesProps) {
  if (isOver18 === null && isOver21 === null) {
    return (
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-tertiary)" }}>
        Unknown
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: "6px" }}>
      <Badge variant={isOver18 === null ? "default" : isOver18 ? "confirmed" : "declined"}>
        {isOver18 === null ? "18+ Unknown" : isOver18 ? "18+" : "Under 18"}
      </Badge>
      <Badge variant={isOver21 === null ? "default" : isOver21 ? "confirmed" : "declined"}>
        {isOver21 === null ? "21+ Unknown" : isOver21 ? "21+" : "Under 21"}
      </Badge>
    </div>
  );
}
