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

function groupBy(lunch: MembershipLunch[], key: (sel: MembershipLunch) => string): [string, MembershipLunch[]][] {
  const groups = new Map<string, MembershipLunch[]>();
  for (const sel of lunch) groups.set(key(sel), [...(groups.get(key(sel)) ?? []), sel]);
  return Array.from(groups.entries());
}

// One track's answers, a row per category. Exported for the overview's
// per-track cards, which already know the track.
export function LunchCategoryRows({ selections }: { selections: MembershipLunch[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {groupBy(selections, (sel) => sel.category).map(([category, rows]) => (
        <div key={category} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
            color: "var(--color-text-secondary)",
          }}>
            {unslug(category)}
          </span>
          {/* A typed answer is a sentence — an uppercase badge
              would mangle it, so it renders as prose. */}
          {rows.map((sel, i) => (
            isFreeText(sel)
              ? <FieldValue key={i}>{sel.value}</FieldValue>
              : <Badge key={i} variant="default">{sel.value}</Badge>
          ))}
        </div>
      ))}
    </div>
  );
}

export function LunchSection({ lunch, dietaryRestriction }: LunchSectionProps) {
  return (
    <ProfileCard>
      <SectionHeading title="Lunch">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {lunch.length === 0 && <FieldValue muted>No info yet</FieldValue>}
          {groupBy(lunch, (sel) => sel.track_name)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([track, selections]) => (
              <PanelField key={track} label={track}>
                <LunchCategoryRows selections={selections} />
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
