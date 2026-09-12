"use client";

import { MembershipLunch } from "@/lib/api";
import { unslug } from "@/lib/textFormat";
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

function groupByTrack(lunch: MembershipLunch[]): [string, [string, MembershipLunch[]][]][] {
  const byTrack = new Map<string, Map<string, MembershipLunch[]>>();
  for (const sel of lunch) {
    const categories = byTrack.get(sel.track_name) ?? new Map<string, MembershipLunch[]>();
    categories.set(sel.category, [...(categories.get(sel.category) ?? []), sel]);
    byTrack.set(sel.track_name, categories);
  }
  return Array.from(byTrack.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([track, categories]) => [track, Array.from(categories.entries())]);
}

export function LunchSection({ lunch, dietaryRestriction }: LunchSectionProps) {
  return (
    <ProfileCard>
      <SectionHeading title="Lunch">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {lunch.length === 0 && <FieldValue muted>No info yet</FieldValue>}
          {groupByTrack(lunch).map(([track, categories]) => (
            <PanelField key={track} label={track}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {categories.map(([category, selections]) => (
                  <div key={category} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{
                      fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                      color: "var(--color-text-secondary)",
                    }}>
                      {unslug(category)}
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
