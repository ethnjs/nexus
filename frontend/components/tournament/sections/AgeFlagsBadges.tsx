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
  // The tournament's own collection toggles. A flag it doesn't collect gets
  // no badge at all — not even "Unknown", which would imply the question was
  // asked. These can't be inferred from the values: the response omits a
  // field both when it isn't collected and when the member withheld consent,
  // so `undefined` alone can't tell those apart, and only the second is
  // worth surfacing.
  collectIsOver18: boolean;
  collectIsOver21: boolean;
}

function AgeBadge({ value, label }: { value: boolean | null | undefined; label: "18+" | "21+" }) {
  return (
    <Badge variant={value == null ? "default" : value ? "confirmed" : "declined"}>
      {value == null ? `${label} Unknown` : value ? label : `Under ${label.replace("+", "")}`}
    </Badge>
  );
}

// Content only, no PanelField wrapper — callers decide the label/layout
// around it (MemberPanel embeds this inside its "Membership" card's grid;
// the profile page may want its own placement).
export function AgeFlagsBadges({ isOver18, isOver21, collectIsOver18, collectIsOver21 }: AgeFlagsBadgesProps) {
  if (!collectIsOver18 && !collectIsOver21) {
    return <FieldValue muted>Unknown</FieldValue>;
  }

  return (
    <div style={{ display: "flex", gap: "6px" }}>
      {collectIsOver18 && <AgeBadge value={isOver18} label="18+" />}
      {collectIsOver21 && <AgeBadge value={isOver21} label="21+" />}
    </div>
  );
}
