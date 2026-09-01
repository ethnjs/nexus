"use client";

import { MembershipAvailability } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/timeFormat";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldList } from "@/components/profile/PanelField";

interface AvailabilitySectionProps {
  availability: MembershipAvailability[];
}

// Self-contained ProfileCard — renders nothing when there's no data, so
// callers can drop this in unconditionally (MemberPanel, and the member's
// own profile page, once per tournament membership).
export function AvailabilitySection({ availability }: AvailabilitySectionProps) {
  if (availability.length === 0) return null;

  return (
    <ProfileCard>
      <SectionHeading title="Availability">
        <PanelField label="Shifts">
          <FieldList>
            {availability.map((slot) => (
              <FieldValue key={slot.shift_id}>
                {slot.label} — {formatDate(slot.start)}, {formatTime(slot.start)}–{formatTime(slot.end)}
              </FieldValue>
            ))}
          </FieldList>
        </PanelField>
      </SectionHeading>
    </ProfileCard>
  );
}
