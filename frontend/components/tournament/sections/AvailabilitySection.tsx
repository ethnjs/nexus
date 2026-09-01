"use client";

import { MembershipAvailability } from "@/lib/api";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField } from "@/components/profile/PanelField";

interface AvailabilitySectionProps {
  availability: MembershipAvailability[];
}

// Buckets shifts by the local calendar day they start on, days and shifts
// both in chronological order. A shift crossing midnight still belongs to
// the day it starts — matching how the schedule itself is presented.
function groupByDay(availability: MembershipAvailability[]): [string, MembershipAvailability[]][] {
  const byDay = new Map<string, MembershipAvailability[]>();
  for (const slot of availability) {
    const day = toDateInput(slot.start);
    const group = byDay.get(day);
    if (group) group.push(slot);
    else byDay.set(day, [slot]);
  }
  for (const group of byDay.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start));
  }
  return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
}

// The day's outer span: earliest start to latest end. Deliberately ignores
// gaps between shifts — this is "when they're around", not hours worked.
// Slots arrive sorted by start, so only the end needs a max.
function dayRange(slots: MembershipAvailability[]): string {
  const end = slots.reduce((latest, s) => (s.end > latest ? s.end : latest), slots[0].end);
  return `${formatTime(slots[0].start)}–${formatTime(end)}`;
}

// Self-contained ProfileCard — renders nothing when there's no data, so
// callers can drop this in unconditionally (MemberPanel, and the member's
// own profile page, once per tournament membership).
export function AvailabilitySection({ availability }: AvailabilitySectionProps) {
  if (availability.length === 0) return null;

  return (
    <ProfileCard>
      <SectionHeading title="Availability">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {groupByDay(availability).map(([day, slots]) => (
            <PanelField key={day} label={`${formatDayLabel(day)}, ${dayRange(slots)}`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {slots.map((slot) => (
                  <Badge
                    key={slot.shift_id}
                    variant="default"
                    title={`${formatTime(slot.start)}–${formatTime(slot.end)}`}
                  >
                    {slot.label}
                  </Badge>
                ))}
              </div>
            </PanelField>
          ))}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
