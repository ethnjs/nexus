"use client";

import { MembershipLunch } from "@/lib/api";
import { formatDayLabel } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue } from "@/components/profile/PanelField";

// lunch_{date}_{category} allows these alongside the option-based types —
// see LUNCH_QUESTION_TYPES.
const FREE_TEXT_TYPES = new Set(["short_text", "long_text"]);

function isFreeText(selection: MembershipLunch): boolean {
  return !!selection.question_type && FREE_TEXT_TYPES.has(selection.question_type);
}

interface LunchSectionProps {
  lunch: MembershipLunch[];
  /**
   * Shown here as well as in the profile's Logistics card — it's the
   * constraint the selections have to satisfy, so reading the lunch section
   * without it is reading half the picture. Deliberately duplicated rather
   * than moved: Logistics is a global profile card and has no lunch context
   * of its own.
   */
  dietaryRestriction?: string | null;
}

// Groups by the bare "YYYY-MM-DD" string, then by category within each day.
// The date deliberately never becomes a Date here — a lunch date has no time
// or timezone, so parsing it as an instant shifts it a day back for anyone
// west of UTC (formatDayLabel is the one exception: it pins to local
// midnight, which round-trips the same calendar day).
function groupByDate(lunch: MembershipLunch[]): [string, [string, MembershipLunch[]][]][] {
  const byDate = new Map<string, Map<string, MembershipLunch[]>>();
  for (const sel of lunch) {
    const categories = byDate.get(sel.date) ?? new Map<string, MembershipLunch[]>();
    categories.set(sel.category, [...(categories.get(sel.category) ?? []), sel]);
    byDate.set(sel.date, categories);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, categories]) => [date, Array.from(categories.entries())]);
}

export function LunchSection({ lunch, dietaryRestriction }: LunchSectionProps) {
  // A restriction with no selections is still worth showing — someone has to
  // order for them either way.
  if (lunch.length === 0 && !dietaryRestriction) return null;

  return (
    <ProfileCard>
      <SectionHeading title="Lunch">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {groupByDate(lunch).map(([date, categories]) => (
            <PanelField key={date} label={formatDayLabel(date)}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {categories.map(([category, selections]) => (
                  <div key={category} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{
                      fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                      color: "var(--color-text-secondary)", textTransform: "capitalize",
                    }}>
                      {category}
                    </span>
                    {/* A typed answer is a sentence — an uppercase badge
                        would mangle it, so it renders as prose. */}
                    {selections.map((sel, i) => (
                      isFreeText(sel)
                        ? <FieldValue key={i}>{sel.value}</FieldValue>
                        : <Badge key={i} variant="default">{sel.value}</Badge>
                    ))}
                  </div>
                ))}
              </div>
            </PanelField>
          ))}
          {dietaryRestriction && (
            <PanelField label="Dietary Restriction">
              <FieldValue>{dietaryRestriction}</FieldValue>
            </PanelField>
          )}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
