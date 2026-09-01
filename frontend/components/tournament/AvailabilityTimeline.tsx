"use client";

// A horizontal bar covering one day's shift window, hour by hour: green where
// the member is available, red where they aren't. Segments are drawn as
// percentage-positioned overlays rather than per-hour cells so a shift ending
// at 3:30 fills exactly half of the 3pm block; the hour gridlines are painted
// on top so the blocks still read as hours.

interface Span {
  start: number;
  end: number;
}

interface AvailabilityTimelineProps {
  /** Domain of the bar, in epoch ms — the day's whole shift window. */
  dayStart: number;
  dayEnd: number;
  /** Available spans, already merged and clamped by the caller. */
  segments: Span[];
}

const HOUR_MS = 3600000;

export function AvailabilityTimeline({ dayStart, dayEnd, segments }: AvailabilityTimelineProps) {
  const total = dayEnd - dayStart;
  if (total <= 0) return null;

  const pct = (ms: number) => `${(ms / total) * 100}%`;

  // Interior hour boundaries only — the bar's own edges already read as
  // divisions, so a line on top of them just thickens the border.
  const ticks: number[] = [];
  for (let t = Math.ceil(dayStart / HOUR_MS) * HOUR_MS; t < dayEnd; t += HOUR_MS) {
    if (t > dayStart) ticks.push(t - dayStart);
  }

  return (
    <div
      style={{
        position: "relative", flex: "0 0 220px", alignSelf: "stretch", minHeight: "34px",
        borderRadius: "var(--radius-sm)", overflow: "hidden",
        border: "1px solid var(--color-border)",
        background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
      }}
    >
      {segments.map((seg) => (
        <div
          key={seg.start}
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: pct(seg.start - dayStart),
            width: pct(seg.end - seg.start),
            background: "color-mix(in srgb, var(--color-success) 28%, transparent)",
          }}
        />
      ))}
      {ticks.map((offset) => (
        <div
          key={offset}
          style={{
            position: "absolute", top: 0, bottom: 0, left: pct(offset),
            width: "1px", background: "var(--color-surface)", opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}
