"use client";

import { MembershipLunch } from "@/lib/api";
import { formatDate } from "@/lib/timeFormat";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { PanelField } from "@/components/tournament/PanelField";

interface LunchSectionProps {
  lunch: MembershipLunch[];
}

export function LunchSection({ lunch }: LunchSectionProps) {
  if (lunch.length === 0) return null;

  return (
    <ProfileCard>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "4px",
      }}>
        Lunch
      </h3>
      <PanelField label="Selections">
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {lunch.map((sel, i) => (
            <span
              key={i}
              style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}
            >
              {formatDate(sel.date)} — {sel.category}: {sel.label}
            </span>
          ))}
        </div>
      </PanelField>
    </ProfileCard>
  );
}
