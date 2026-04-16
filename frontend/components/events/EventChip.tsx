"use client";

import { Event, TournamentCategory } from "@/lib/api";
import { catColorVars } from "@/lib/formatters";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface EventChipProps {
  event:       Event;
  categories:  TournamentCategory[];
  colorBy:     "category" | "division" | "type";
  columnWidth: number;  // px — controls label truncation / location visibility
  spanCount:   number;  // number of time-block columns this chip spans
  onClick:     () => void;
}

// ─── Color resolver ───────────────────────────────────────────────────────────

interface ChipColors {
  bg:     string;
  text:   string;
  border: string;
  dashed: boolean;
}

function resolveColors(
  event:      Event,
  categories: TournamentCategory[],
  colorBy:    "category" | "division" | "type",
): ChipColors {
  const isTrial = event.event_type === "trial";

  if (colorBy === "category") {
    const idx = categories.findIndex((c) => c.id === event.category_id);
    if (idx >= 0) {
      const cv = catColorVars(idx);
      return { bg: cv.subtle, text: cv.text, border: cv.main, dashed: isTrial };
    }
    // No category — fall back to a neutral accent
    return {
      bg:     "var(--color-accent-subtle)",
      text:   "var(--color-text-primary)",
      border: "var(--color-accent)",
      dashed: isTrial,
    };
  }

  if (colorBy === "division") {
    const key = event.division ? event.division.toLowerCase() : "none";
    return {
      bg:     `var(--color-div-${key}-subtle)`,
      text:   `var(--color-div-${key}-text)`,
      border: `var(--color-div-${key})`,
      dashed: isTrial,
    };
  }

  // colorBy === "type"
  if (isTrial) {
    return {
      bg:     "var(--color-type-trial-subtle)",
      text:   "var(--color-type-trial-text)",
      border: "var(--color-type-trial)",
      dashed: true,
    };
  }
  return {
    bg:     "var(--color-type-standard-subtle)",
    text:   "var(--color-type-standard-text)",
    border: "var(--color-type-standard)",
    dashed: false,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventChip({
  event,
  categories,
  colorBy,
  columnWidth,
  spanCount,
  onClick,
}: EventChipProps) {
  const colors  = resolveColors(event, categories, colorBy);
  const width   = spanCount * columnWidth - 8;
  const showLoc = columnWidth >= 155;

  const location = [event.building, event.room].filter(Boolean).join(" · ");

  return (
    <div
      title={event.name}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position:    "absolute",
        top:         "5px",
        bottom:      "5px",
        left:        "4px",
        width:       `${width}px`,
        background:  colors.bg,
        border:      `1px ${colors.dashed ? "dashed" : "solid"} ${colors.border}`,
        borderRadius: "var(--radius-sm)",
        padding:      "3px 7px",
        cursor:       "pointer",
        overflow:     "hidden",
        display:      "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap:           "2px",
        transition:    "box-shadow var(--transition-fast), filter var(--transition-fast)",
        boxSizing:     "border-box",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.filter    = "brightness(0.95)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-sm)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.filter    = "";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "";
      }}
    >
      {/* Event name */}
      <span style={{
        fontFamily:   "var(--font-sans)",
        fontSize:     "11px",
        fontWeight:   600,
        color:        colors.text,
        lineHeight:   1.3,
        whiteSpace:   "nowrap",
        overflow:     "hidden",
        textOverflow: "ellipsis",
      }}>
        {event.name}
      </span>

      {/* Location — only at 155px+ column width */}
      {showLoc && location && (
        <span style={{
          fontFamily:   "var(--font-mono)",
          fontSize:     "10px",
          color:        colors.text,
          opacity:      0.7,
          lineHeight:   1.3,
          whiteSpace:   "nowrap",
          overflow:     "hidden",
          textOverflow: "ellipsis",
        }}>
          {location}
        </span>
      )}
    </div>
  );
}
