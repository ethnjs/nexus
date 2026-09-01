"use client";

import { Badge } from "@/components/ui/Badge";
import { FieldValue } from "@/components/profile/PanelField";

interface AgeFlagsBadgesProps {
  // `undefined` covers the field being omitted from the API response
  // entirely (the backend's age-disclosure gate — not collected, or
  // collected but not consented) — treated identically to `null`
  // ("no DOB on file"). Neither must ever fall through to the `false`
  // branch below, which would render as "Under 18"/"Under 21".
  isOver18: boolean | null | undefined;
  isOver21: boolean | null | undefined;
}

// Content only, no PanelField wrapper — callers decide the label/layout
// around it (MemberPanel embeds this inside its "Membership" card's grid;
// the profile page may want its own placement).
export function AgeFlagsBadges({ isOver18, isOver21 }: AgeFlagsBadgesProps) {
  if (isOver18 == null && isOver21 == null) {
    return (
      <FieldValue muted>Unknown</FieldValue>
    );
  }

  return (
    <div style={{ display: "flex", gap: "6px" }}>
      <Badge variant={isOver18 == null ? "default" : isOver18 ? "confirmed" : "declined"}>
        {isOver18 == null ? "18+ Unknown" : isOver18 ? "18+" : "Under 18"}
      </Badge>
      <Badge variant={isOver21 == null ? "default" : isOver21 ? "confirmed" : "declined"}>
        {isOver21 == null ? "21+ Unknown" : isOver21 ? "21+" : "Under 21"}
      </Badge>
    </div>
  );
}
