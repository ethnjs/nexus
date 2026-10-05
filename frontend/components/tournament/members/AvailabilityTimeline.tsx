"use client";

import { useEffect, useRef, useState } from "react";

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
  /** Fill the parent's width instead of sitting beside something at 220px — for stacked layouts. */
  fullWidth?: boolean;
}

const HOUR_MS = 3600000;

/**
 * The bar's pixel width, so the hour lines can be placed on whole device
 * pixels.
 *
 * A line at a percentage offset lands wherever the arithmetic puts it, which
 * on a fractional boundary the browser paints across two physical pixels —
 * so on a scaled display (Windows at 125%, any HiDPI screen) some lines come
 * out a shade thicker than their neighbours. Rounding each offset to a device
 * pixel makes every line land the same way, which is what makes them look
 * alike.
 */
function useBarWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** `x` snapped to the nearest physical pixel. Falls back to the raw value
 *  before the first measurement, when there is no width to snap against. */
function snap(x: number): number {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.round(x * ratio) / ratio;
}

// The frame's radius less its 1px border — the arc a block sitting against
// that edge has to match exactly.
const INNER_RADIUS = "calc(var(--radius-sm) - 1px)";

/**
 * One block's edges, as offsets from the bar's own two edges.
 *
 * `right`, not `width`: a block running to the end of the day computed its
 * width as a percentage, and left% + width% lands a fraction of a pixel short
 * of 100% on most bar widths — which paints a hairline of the bar's pink
 * background between the green and the frame. Pinning the far edge to 0
 * leaves nothing to round.
 */
function blockEdges(start: number, end: number, dayStart: number, dayEnd: number) {
  const total = dayEnd - dayStart;
  const atStart = start <= dayStart;
  const atEnd = end >= dayEnd;
  return {
    left: atStart ? 0 : `${((start - dayStart) / total) * 100}%`,
    right: atEnd ? 0 : `${((dayEnd - end) / total) * 100}%`,
    ...endRadii(atStart, atEnd),
  };
}

function endRadii(atStart: boolean, atEnd: boolean) {
  if (!atStart && !atEnd) return null;
  return {
    borderTopLeftRadius: atStart ? INNER_RADIUS : undefined,
    borderBottomLeftRadius: atStart ? INNER_RADIUS : undefined,
    borderTopRightRadius: atEnd ? INNER_RADIUS : undefined,
    borderBottomRightRadius: atEnd ? INNER_RADIUS : undefined,
  };
}

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

// The one definition of "available" and "not", exported because the member
// panel's assignments section shades its own timeline with them — the same
// green has to mean the same thing at the same weight wherever a member's
// availability is drawn.
//
// Light, because in both places the colour sits *under* something: chips and
// role pills there, the shift blocks and their labels here. It reads as a
// ground rather than as a mark.
export const AVAILABILITY_GREEN = "color-mix(in srgb, var(--color-success) 13%, transparent)";
export const AVAILABILITY_RED = "color-mix(in srgb, var(--color-danger) 6%, transparent)";

const GREEN = AVAILABILITY_GREEN;
// Hover is the one place the green is the mark rather than the ground: it
// answers "which block is this badge?", so it stays well clear of the resting
// fill instead of scaling with it.
const GREEN_HOVER = "color-mix(in srgb, var(--color-success) 34%, transparent)";
const RED = AVAILABILITY_RED;

function timeRange(span: Span): string {
  return `${formatTime(new Date(span.start).toISOString())}–${formatTime(new Date(span.end).toISOString())}`;
}

export function AvailabilityTimeline({ dayStart, dayEnd, shifts, hoveredId, onHover, fullWidth }: AvailabilityTimelineProps) {
  // Above the early return below — a hook cannot be called conditionally.
  const { ref: barRef, width: barWidth } = useBarWidth();
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
      position: "relative", alignSelf: "stretch",
      // A flex-basis would size the height in a column, so stacked callers get a width.
      ...(fullWidth ? { width: "100%" } : { flex: "0 0 220px" }),
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

      <div ref={barRef} style={{
        position: "relative", height: "22px",
        borderRadius: "var(--radius-sm)", overflow: "hidden",
        border: "1px solid var(--color-border-strong)", background: RED,
      }}>
        {mergeSpans(clamped).map((span) => (
          <div
            key={span.start}
            style={{
              position: "absolute", top: 0, bottom: 0,
              // A block touching an end of the bar also takes that end's
              // corners: the bar is square-cornered content behind a rounded,
              // clipping frame, so otherwise the corner arcs clip the green
              // away and the pink background shows through them.
              ...blockEdges(span.start, span.end, dayStart, dayEnd),
              background: GREEN,
            }}
          />
        ))}
        {/* Gridlines sit above the fills but must not eat the hover below. */}
        {hours.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute", top: 0, bottom: 0,
              left: barWidth
                ? `${snap(((t - dayStart) / total) * barWidth)}px`
                : pct(t - dayStart),
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
              ...blockEdges(shift.start, shift.end, dayStart, dayEnd),
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
