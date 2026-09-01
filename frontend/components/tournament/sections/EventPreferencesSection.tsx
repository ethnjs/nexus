"use client";

import { MembershipEventPreference } from "@/lib/api";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldList } from "@/components/profile/PanelField";

interface EventPreferencesSectionProps {
  eventPreferences: MembershipEventPreference[];
}

export function EventPreferencesSection({ eventPreferences }: EventPreferencesSectionProps) {
  if (eventPreferences.length === 0) return null;

  return (
    <ProfileCard>
      <SectionHeading title="Event Preferences">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {eventPreferences.map((pref) => (
            <PanelField key={pref.key} label={pref.key.replace(/_/g, " ")}>
              <FieldList>
                {pref.events.map((ev) => (
                  <FieldValue key={ev.id}>
                    {ev.rank !== null ? `${ev.rank}. ` : ""}{ev.name ?? "Unknown event"}{ev.division ? ` (${ev.division})` : ""}
                  </FieldValue>
                ))}
              </FieldList>
            </PanelField>
          ))}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
