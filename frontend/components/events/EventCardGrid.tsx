"use client";

import { useState, useMemo } from "react";
import { Event, TournamentCategory } from "@/lib/api";
import { catColorVars } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";
import { IconPlus, IconSearch } from "@/components/ui/Icons";
import { EventCard } from "@/components/events/EventCard";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  events:            Event[];
  categories:        TournamentCategory[];
  onCardClick:       (event: Event) => void;
  onAddClick:        () => void;
  selectMode?:       boolean;
  selectedIds?:      Set<number>;
  onToggleSelect?:   (id: number) => void;
  onEnterSelectMode?: () => void;
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type DivFilter  = "B" | "C" | null;
type TypeFilter = "standard" | "trial" | null;

// ─── Component ────────────────────────────────────────────────────────────────

export function EventCardGrid({ events, categories, onCardClick, onAddClick, selectMode, selectedIds, onToggleSelect, onEnterSelectMode }: Props) {
  const [search,     setSearch]     = useState("");
  const [division,   setDivision]   = useState<DivFilter>(null);
  const [eventType,  setEventType]  = useState<TypeFilter>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return events.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (division   !== null && e.division   !== division)   return false;
      if (eventType  !== null && e.event_type !== eventType)  return false;
      if (categoryId !== null && e.category_id !== categoryId) return false;
      return true;
    });
  }, [events, search, division, eventType, categoryId]);

  // ── Shared styles ──────────────────────────────────────────────────────────

  const filterBtn = (active: boolean): React.CSSProperties => ({
    fontFamily:   "var(--font-sans)",
    fontSize:     "12px",
    fontWeight:   active ? 600 : 400,
    color:        active ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
    background:   active ? "var(--color-accent)" : "transparent",
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    height:       "30px",
    padding:      "0 10px",
    cursor:       "pointer",
    transition:   "background var(--transition-fast), color var(--transition-fast)",
    whiteSpace:   "nowrap",
    boxSizing:    "border-box",
  });

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          "10px",
        marginBottom: "16px",
        flexWrap:     "wrap",
      }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: "160px", maxWidth: "280px" }}>
          <span style={{
            position:  "absolute",
            left:      "9px",
            top:       "50%",
            transform: "translateY(-50%)",
            color:     "var(--color-text-tertiary)",
            display:   "flex",
            pointerEvents: "none",
          }}>
            <IconSearch size={13} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            style={{
              width:        "100%",
              height:       "30px",
              padding:      "0 10px 0 28px",
              fontFamily:   "var(--font-mono)",
              fontSize:     "12px",
              color:        "var(--color-text-primary)",
              background:   "var(--color-surface)",
              border:       "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              outline:      "none",
              boxSizing:    "border-box",
            }}
          />
        </div>

        {/* Division filter */}
        <div style={{ display: "flex", gap: "4px" }}>
          {([null, "B", "C"] as DivFilter[]).map((d) => (
            <button key={String(d)} style={filterBtn(division === d)} onClick={() => setDivision(d)}>
              {d === null ? "All divs" : `Div ${d}`}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div style={{ display: "flex", gap: "4px" }}>
          {([null, "standard", "trial"] as TypeFilter[]).map((t) => (
            <button key={String(t)} style={filterBtn(eventType === t)} onClick={() => setEventType(t)}>
              {t === null ? "All types" : t === "standard" ? "Standard" : "Trial"}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Result count */}
        <span style={{
          fontFamily: "var(--font-sans)",
          fontSize:   "12px",
          color:      "var(--color-text-tertiary)",
          whiteSpace: "nowrap",
        }}>
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        </span>

        {/* Select button */}
        {!selectMode && (
          <Button size="sm" variant="secondary" onClick={onEnterSelectMode}>
            Select
          </Button>
        )}

        {/* Add event */}
        <Button size="sm" onClick={onAddClick}>
          <IconPlus size={12} />
          Add event
        </Button>
      </div>

      {/* ── Category chips ── */}
      {categories.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "16px" }}>
          <button
            style={filterBtn(categoryId === null)}
            onClick={() => setCategoryId(null)}
          >
            All categories
          </button>
          {categories.map((cat, idx) => {
            const active = categoryId === cat.id;
            const cv     = catColorVars(idx);
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryId(active ? null : cat.id)}
                style={{
                  fontFamily:   "var(--font-sans)",
                  fontSize:     "12px",
                  fontWeight:   active ? 600 : 400,
                  color:        active ? cv.text : "var(--color-text-secondary)",
                  background:   active ? cv.subtle : "transparent",
                  border:       `1px solid ${active ? cv.main : "var(--color-border)"}`,
                  borderRadius: "var(--radius-sm)",
                  height:       "30px",
                  padding:      "0 10px",
                  cursor:       "pointer",
                  transition:   "background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)",
                  whiteSpace:   "nowrap",
                  boxSizing:    "border-box",
                }}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Cards grid ── */}
      {filtered.length === 0 ? (
        <div style={{
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          height:         "260px",
          gap:            "10px",
          border:         "1px dashed var(--color-border)",
          borderRadius:   "var(--radius-md)",
          color:          "var(--color-text-tertiary)",
          fontFamily:     "var(--font-sans)",
          fontSize:       "13px",
        }}>
          {events.length === 0 ? (
            <>
              <span>No events yet.</span>
              <Button size="sm" onClick={onAddClick}>
                <IconPlus size={12} />
                Add first event
              </Button>
            </>
          ) : (
            <span>No events match your filters.</span>
          )}
        </div>
      ) : (
        <div style={{
          display:             "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap:                 "12px",
        }}>
          {filtered.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              categories={categories}
              onClick={selectMode ? undefined : () => onCardClick(event)}
              selectMode={selectMode}
              selected={selectedIds?.has(event.id)}
              onToggleSelect={() => onToggleSelect?.(event.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
