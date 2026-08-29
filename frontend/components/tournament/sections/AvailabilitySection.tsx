"use client";

import { MembershipAvailability } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/timeFormat";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { PanelField } from "@/components/tournament/PanelField";

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
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "4px",
      }}>
        Availability
      </h3>
      <PanelField label="Shifts">
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {availability.map((slot) => (
            <span
              key={slot.shift_id}
              style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}
            >
              {slot.label} — {formatDate(slot.start)}, {formatTime(slot.start)}–{formatTime(slot.end)}
            </span>
          ))}
        </div>
      </PanelField>
    </ProfileCard>
  );
}
