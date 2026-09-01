"use client";

import { MembershipAvailability, TournamentShift } from "@/lib/api";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField } from "@/components/profile/PanelField";
import { AvailabilityTimeline } from "@/components/tournament/AvailabilityTimeline";

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

interface Span {
  start: number;
  end: number;
}

function toSpan(slot: { start: string; end: string }): Span {
  return { start: new Date(slot.start).getTime(), end: new Date(slot.end).getTime() };
}

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

// Collapses overlapping/touching spans into disjoint ones, so two shifts
// sharing an hour paint one continuous green block instead of stacking
// translucent fills into a darker seam. Input must be sorted by start.
function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

// Trims spans to the bar's window, so a shift missing from the tournament's
// shift list (a stale fetch) can't paint outside the bar.
function clampSpans(spans: Span[], bounds: Span): Span[] {
  return spans
    .map((s) => ({ start: Math.max(s.start, bounds.start), end: Math.min(s.end, bounds.end) }))
    .filter((s) => s.end > s.start);
}

// Snapped out to whole hours so every block on the bar is a full hour wide —
// a window of 7:30–6:15 would otherwise leave slivers at both ends.
function hourWindow(spans: Span[]): Span {
  const start = Math.min(...spans.map((s) => s.start));
  const end = Math.max(...spans.map((s) => s.end));
  return {
    start: Math.floor(start / HOUR_MS) * HOUR_MS,
    end: Math.ceil(end / HOUR_MS) * HOUR_MS,
  };
}

// Self-contained ProfileCard — renders nothing when there's no data, so
// callers can drop this in unconditionally (MemberPanel, and the member's
// own profile page, once per tournament membership).
export function AvailabilitySection({ availability, allShifts }: AvailabilitySectionProps) {
  if (availability.length === 0) return null;

  const shiftsByDay = groupByDay(allShifts ?? []);

  return (
    <ProfileCard>
      <SectionHeading title="Availability">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {Array.from(groupByDay(availability).entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, slots]) => {
              const taken = mergeSpans(slots.map(toSpan));
              const offered = shiftsByDay.get(day)?.map(toSpan);
              const barWindow = hourWindow(offered?.length ? offered : taken);
              const lastEnd = slots.reduce((latest, s) => (s.end > latest ? s.end : latest), slots[0].end);
              const label = `${formatDayLabel(day)}, ${formatTime(slots[0].start)}–${formatTime(lastEnd)}`;

              return (
                <div key={day} style={{ display: "flex", alignItems: "stretch", gap: "16px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PanelField label={label}>
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
                  <AvailabilityTimeline dayStart={barWindow.start} dayEnd={barWindow.end} segments={clampSpans(taken, barWindow)} />
                </div>
              );
            })}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}
