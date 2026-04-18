"use client";

import { Event, TournamentCategory } from "@/lib/api";
import { catColorVars } from "@/lib/formatters";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  event:            Event;
  categories:       TournamentCategory[];
  onClick?:         () => void;
  selectMode?:      boolean;
  selected?:        boolean;
  onToggleSelect?:  () => void;
}

// ─── Small badge ─────────────────────────────────────────────────────────────

function Chip({
  label,
  bg,
  color,
  border,
  dashed,
}: {
  label:   string;
  bg?:     string;
  color?:  string;
  border?: string;
  dashed?: boolean;
}) {
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      padding:      "2px 7px",
      fontFamily:   "var(--font-sans)",
      fontSize:     "11px",
      fontWeight:   600,
      borderRadius: "var(--radius-sm)",
      background:   bg     ?? "var(--color-surface-raised)",
      color:        color  ?? "var(--color-text-secondary)",
      border:       `1px ${dashed ? "dashed" : "solid"} ${border ?? "var(--color-border)"}`,
      whiteSpace:   "nowrap",
      lineHeight:   "18px",
    }}>
      {label}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventCard({ event, categories, onClick, selectMode, selected, onToggleSelect }: Props) {
  // Category color
  const catIdx   = categories.findIndex((c) => c.id === event.category_id);
  const catName  = catIdx >= 0 ? categories[catIdx].name : null;
  const catColor = catIdx >= 0 ? catColorVars(catIdx) : null;

  // Location string
  const locationParts = [event.building, event.room, event.floor].filter(Boolean);
  const location = locationParts.join(" · ");

  const handleClick = selectMode ? onToggleSelect : onClick;
  const isInteractive = !!handleClick;

  return (
    <div
      onClick={handleClick}
      style={{
        position:      "relative",
        background:    selected ? "var(--color-accent-subtle)" : "var(--color-surface)",
        border:        `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius:  "var(--radius-md)",
        padding:       "14px 16px",
        cursor:        isInteractive ? "pointer" : "default",
        transition:    "box-shadow var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast)",
        display:       "flex",
        flexDirection: "column",
        gap:           "8px",
      }}
      onMouseEnter={(e) => {
        if (!isInteractive || selected) return;
        (e.currentTarget as HTMLDivElement).style.boxShadow   = "var(--shadow-md)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        if (selected) return;
        (e.currentTarget as HTMLDivElement).style.boxShadow   = "";
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)";
      }}
    >
      {/* Checkbox overlay in select mode */}
      {selectMode && (
        <div style={{
          position:       "absolute",
          top:            "10px",
          left:           "10px",
          width:          "16px",
          height:         "16px",
          borderRadius:   "3px",
          border:         `2px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
          background:     selected ? "var(--color-accent)" : "var(--color-surface)",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          flexShrink:     0,
          transition:     "background var(--transition-fast), border-color var(--transition-fast)",
        }}>
          {selected && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}

      {/* ── Row 1: name + division ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", paddingLeft: selectMode ? "22px" : 0 }}>
        <span style={{
          flex:       1,
          fontFamily: "var(--font-serif)",
          fontSize:   "15px",
          fontWeight: 400,
          color:      "var(--color-text-primary)",
          lineHeight: 1.35,
          wordBreak:  "break-word",
        }}>
          {event.name}
        </span>

        {event.division && (
          <Chip
            label={`Div ${event.division}`}
            bg={`var(--color-div-${event.division.toLowerCase()}-subtle)`}
            color={`var(--color-div-${event.division.toLowerCase()}-text)`}
            border={`var(--color-div-${event.division.toLowerCase()})`}
          />
        )}
      </div>

      {/* ── Row 2: category + type badges ── */}
      {(catName || event.event_type === "trial") && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {catName && catColor && (
            <Chip
              label={catName}
              bg={catColor.subtle}
              color={catColor.text}
              border={catColor.main}
            />
          )}
          {event.event_type === "trial" && (
            <Chip
              label="Trial"
              bg="var(--color-type-trial-subtle)"
              color="var(--color-type-trial-text)"
              border="var(--color-type-trial)"
            />
          )}
        </div>
      )}

      {/* ── Row 3: location ── */}
      {location && (
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize:   "12px",
          color:      "var(--color-text-tertiary)",
          lineHeight: 1.4,
        }}>
          {location}
        </span>
      )}

      {/* ── Row 4: time block tags or Unscheduled ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {event.time_blocks.length === 0 ? (
          <Chip
            label="Unscheduled"
            dashed
            color="var(--color-text-tertiary)"
            border="var(--color-border)"
          />
        ) : (
          event.time_blocks.map((block) => (
            <span
              key={block.id}
              style={{
                display:      "inline-flex",
                padding:      "2px 8px",
                background:   "var(--color-accent-subtle)",
                border:       "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                fontFamily:   "var(--font-sans)",
                fontSize:     "11px",
                fontWeight:   600,
                color:        "var(--color-text-primary)",
                lineHeight:   "18px",
              }}
            >
              {block.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
