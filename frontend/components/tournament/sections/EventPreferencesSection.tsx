"use client";

import { MembershipEventPreference } from "@/lib/api";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { PanelField } from "@/components/tournament/PanelField";

interface EventPreferencesSectionProps {
  eventPreferences: MembershipEventPreference[];
}

export function EventPreferencesSection({ eventPreferences }: EventPreferencesSectionProps) {
  if (eventPreferences.length === 0) return null;

  return (
    <ProfileCard>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "4px",
      }}>
        Event Preferences
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {eventPreferences.map((pref) => (
          <PanelField key={pref.key} label={pref.key.replace(/_/g, " ")}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {pref.events.map((ev) => (
                <span
                  key={ev.id}
                  style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}
                >
                  {ev.rank !== null ? `${ev.rank}. ` : ""}{ev.name ?? "Unknown event"}{ev.division ? ` (${ev.division})` : ""}
                </span>
              ))}
            </div>
          </PanelField>
        ))}
      </div>
    </ProfileCard>
  );
}
