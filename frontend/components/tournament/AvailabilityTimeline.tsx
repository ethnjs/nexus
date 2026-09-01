"use client";

import { Badge } from "@/components/ui/Badge";
import { formatTime } from "@/lib/timeFormat";

// A horizontal bar covering one day's shift window, hour by hour: green where
// the member is available, red where they aren't. Regions are drawn as
// percentage-positioned blocks rather than per-hour cells so a shift ending at
// 3:30 fills exactly half of the 3pm block; hour gridlines are painted on top
// so the blocks still read as hours, and an hour ruler above labels every
// other line.

interface Span {
  start: number;
  end: number;
}

export interface TimelineShift extends Span {
  id: number;
  label: string;
}

interface AvailabilityTimelineProps {
  /** Domain of the bar, in epoch ms — the day's whole shift window. */
  dayStart: number;
  dayEnd: number;
  /** The member's shifts on this day, in epoch ms. */
  shifts: TimelineShift[];
  /**
   * Hover is owned by the caller so the badge list and the bar highlight
   * together — either one can be the thing the cursor is actually over.
   */
  hoveredId: number | null;
  onHover: (id: number | null) => void;
}

const HOUR_MS = 3600000;

// Every hour boundary strictly inside the window — where the gridlines go.
function interiorHours(dayStart: number, dayEnd: number): number[] {
  const hours: number[] = [];
  for (let t = Math.ceil(dayStart / HOUR_MS) * HOUR_MS; t < dayEnd; t += HOUR_MS) {
    if (t > dayStart) hours.push(t);
  }
  return hours;
}

// Collapses overlapping/touching shifts into disjoint green blocks, so two
// shifts sharing an hour paint one continuous fill instead of stacking
// translucent layers into a darker seam. Input must be sorted by start.
function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

const GREEN = "color-mix(in srgb, var(--color-success) 28%, transparent)";
const GREEN_HOVER = "color-mix(in srgb, var(--color-success) 60%, transparent)";
const RED = "color-mix(in srgb, var(--color-danger) 12%, transparent)";

function timeRange(span: Span): string {
  return `${formatTime(new Date(span.start).toISOString())}–${formatTime(new Date(span.end).toISOString())}`;
}

export function AvailabilityTimeline({ dayStart, dayEnd, shifts, hoveredId, onHover }: AvailabilityTimelineProps) {
  const total = dayEnd - dayStart;
  if (total <= 0) return null;

  const pct = (ms: number) => `${(ms / total) * 100}%`;
  const hours = interiorHours(dayStart, dayEnd);
  // Clamped so a shift missing from the tournament's shift list (a stale
  // fetch) can't paint or hover outside the bar.
  const clamped = shifts
    .map((s) => ({ ...s, start: Math.max(s.start, dayStart), end: Math.min(s.end, dayEnd) }))
    .filter((s) => s.end > s.start);
  const hovered = clamped.find((s) => s.id === hoveredId) ?? null;

  return (
    <div style={{
      position: "relative", flex: "0 0 220px", alignSelf: "stretch",
      display: "flex", flexDirection: "column", justifyContent: "center", gap: "3px",
    }}>
      {/* Hour ruler — every other line is labelled, so a dense window stays
          readable while the unlabelled lines are still placeable. */}
      <div style={{
        position: "relative", height: "11px",
        fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--color-text-tertiary)",
      }}>
        {[dayStart, ...hours].map((t, i) => i % 2 === 0 && (
          <span
            key={t}
            style={{
              position: "absolute", left: pct(t - dayStart),
              transform: t === dayStart ? "none" : "translateX(-50%)",
            }}
          >
            {new Date(t).getHours() % 12 === 0 ? 12 : new Date(t).getHours() % 12}
          </span>
        ))}
      </div>

      <div style={{
        position: "relative", height: "22px",
        borderRadius: "var(--radius-sm)", overflow: "hidden",
        border: "1px solid var(--color-border-strong)", background: RED,
      }}>
        {mergeSpans(clamped).map((span) => (
          <div
            key={span.start}
            style={{
              position: "absolute", top: 0, bottom: 0,
              left: pct(span.start - dayStart), width: pct(span.end - span.start),
              background: GREEN,
            }}
          />
        ))}
        {/* Gridlines sit above the fills but must not eat the hover below. */}
        {hours.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute", top: 0, bottom: 0, left: pct(t - dayStart),
              width: "1px", background: "var(--color-border-strong)", pointerEvents: "none",
            }}
          />
        ))}
        {/* Hover targets are the individual shifts, not the merged fill — two
            overlapping shifts stay separately identifiable. */}
        {clamped.map((shift) => (
          <div
            key={shift.id}
            onMouseEnter={() => onHover(shift.id)}
            onMouseLeave={() => onHover(null)}
            style={{
              position: "absolute", top: 0, bottom: 0,
              left: pct(shift.start - dayStart), width: pct(shift.end - shift.start),
              background: hoveredId === shift.id ? GREEN_HOVER : "transparent",
              transition: "background 120ms ease",
            }}
          />
        ))}
      </div>

      {/* Anchored to the right edge so it grows back into the card rather than
          off the panel — the bar sits at the far right of the row. */}
      {hovered && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 10,
          display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap",
          padding: "4px 8px", borderRadius: "var(--radius-sm)",
          background: "var(--color-surface)", border: "1px solid var(--color-border-strong)",
          boxShadow: "var(--shadow-md)",
        }}>
          <Badge variant="default">{hovered.label}</Badge>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
            {timeRange(hovered)}
          </span>
        </div>
      )}
    </div>
  );
}
