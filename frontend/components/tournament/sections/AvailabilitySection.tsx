"use client";

import { MembershipAvailability, TournamentShift } from "@/lib/api";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField } from "@/components/profile/PanelField";
import { AvailabilityTimeline, TimelineShift } from "@/components/tournament/AvailabilityTimeline";

interface AvailabilitySectionProps {
  availability: MembershipAvailability[];
  /**
   * Every shift the tournament offers — sets each day's timeline window, so
   * hours the member was offered but declined show as unavailable. Omit it
   * (e.g. a caller that hasn't loaded shifts) and the window falls back to
   * the member's own span, where only gaps between their shifts read as red.
   */
  allShifts?: TournamentShift[];
}

const HOUR_MS = 3600000;

// Buckets shifts by the local calendar day they start on, days and shifts
// both in chronological order. A shift crossing midnight still belongs to
// the day it starts — matching how the schedule itself is presented.
function groupByDay<T extends { start: string }>(shifts: T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const shift of shifts) {
    const day = toDateInput(shift.start);
    const group = byDay.get(day);
    if (group) group.push(shift);
    else byDay.set(day, [shift]);
  }
  for (const group of byDay.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start));
  }
  return byDay;
}

// Snapped out to whole hours so every block on the bar is a full hour wide —
// a window of 7:30–6:15 would otherwise leave slivers at both ends.
function hourWindow(shifts: { start: string; end: string }[]): { start: number; end: number } {
  const starts = shifts.map((s) => new Date(s.start).getTime());
  const ends = shifts.map((s) => new Date(s.end).getTime());
  return {
    start: Math.floor(Math.min(...starts) / HOUR_MS) * HOUR_MS,
    end: Math.ceil(Math.max(...ends) / HOUR_MS) * HOUR_MS,
  };
}

function toTimelineShifts(slots: MembershipAvailability[]): TimelineShift[] {
  return slots.map((slot) => ({
    id: slot.shift_id,
    label: slot.label,
    start: new Date(slot.start).getTime(),
    end: new Date(slot.end).getTime(),
  }));
}

// Self-contained ProfileCard — renders nothing when there's no data, so
// callers can drop this in unconditionally (MemberPanel, and the member's
// own profile page, once per tournament membership).
export function AvailabilitySection({ availability, allShifts }: AvailabilitySectionProps) {
  if (availability.length === 0) return null;

  const offeredByDay = groupByDay(allShifts ?? []);

  return (
    <ProfileCard>
      <SectionHeading title="Availability">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {Array.from(groupByDay(availability).entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, slots]) => {
              const offered = offeredByDay.get(day);
              const barWindow = hourWindow(offered?.length ? offered : slots);
              const lastEnd = slots.reduce((latest, s) => (s.end > latest ? s.end : latest), slots[0].end);

              return (
                <div key={day} style={{ display: "flex", alignItems: "stretch", gap: "16px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PanelField label={`${formatDayLabel(day)}, ${formatTime(slots[0].start)}–${formatTime(lastEnd)}`}>
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
                  </div>
                  <AvailabilityTimeline
                    dayStart={barWindow.start}
                    dayEnd={barWindow.end}
                    shifts={toTimelineShifts(slots)}
                  />
                </div>
              );
            })}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
