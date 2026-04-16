"use client";

import { useMemo, useRef, useState } from "react";
import { Event, TimeBlock, TournamentCategory } from "@/lib/api";
import { fmtDate, fmtTime, catColorVars } from "@/lib/formatters";
import { EventChip } from "@/components/events/EventChip";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";

// ─── Constants ────────────────────────────────────────────────────────────────

const ZOOM_LEVELS = [70, 110, 155, 210] as const;
const LABEL_W     = 160;   // px — sticky left label column
const ROW_H       = 44;    // px — event row height
const DATE_ROW_H  = 26;    // px — top header row
const BLOCK_ROW_H = 32;    // px — bottom header row

type ColorBy = "category" | "division" | "type";
type GroupBy = "category" | "building" | "az";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  events:       Event[];
  timeBlocks:   TimeBlock[];
  categories:   TournamentCategory[];
  onEventClick: (event: Event) => void;
  onAddClick:   () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface Run { startIdx: number; spanCount: number }

function getRuns(event: Event, timeBlocks: TimeBlock[]): Run[] {
  const indices = (event.time_block_ids ?? [])
    .map((id) => timeBlocks.findIndex((b) => b.id === id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (indices.length === 0) return [];
  const runs: Run[] = [];
  let s = indices[0], e = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === e + 1) { e = indices[i]; }
    else { runs.push({ startIdx: s, spanCount: e - s + 1 }); s = e = indices[i]; }
  }
  runs.push({ startIdx: s, spanCount: e - s + 1 });
  return runs;
}

interface Group { key: string; label: string; events: Event[] }

function buildGroups(
  events:     Event[],
  categories: TournamentCategory[],
  groupBy:    GroupBy,
): Group[] {
  if (groupBy === "az") {
    const map = new Map<string, Group>();
    [...events].sort((a, b) => a.name.localeCompare(b.name)).forEach((ev) => {
      const key = ev.name[0]?.toUpperCase() ?? "#";
      if (!map.has(key)) map.set(key, { key, label: key, events: [] });
      map.get(key)!.events.push(ev);
    });
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  if (groupBy === "category") {
    const map = new Map<string, Group>();
    categories.forEach((cat) =>
      map.set(String(cat.id), { key: String(cat.id), label: cat.name, events: [] }),
    );
    map.set("null", { key: "null", label: "Uncategorized", events: [] });
    events.forEach((ev) => {
      const key = ev.category_id !== null ? String(ev.category_id) : "null";
      map.get(key)?.events.push(ev);
    });
    return [...map.values()].filter((g) => g.events.length > 0);
  }
  // groupBy === "building"
  const map = new Map<string, Group>();
  events.forEach((ev) => {
    const key   = ev.building ?? "";
    const label = ev.building ?? "No building";
    if (!map.has(key)) map.set(key, { key, label, events: [] });
    map.get(key)!.events.push(ev);
  });
  return [...map.values()]
    .map((g) => ({ ...g, events: [...g.events].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

interface DateGroup { date: string; label: string; blockCount: number }

function buildDateGroups(timeBlocks: TimeBlock[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const b of timeBlocks) {
    const last = groups[groups.length - 1];
    if (last && last.date === b.date) { last.blockCount++; }
    else { groups.push({ date: b.date, label: fmtDate(b.date), blockCount: 1 }); }
  }
  return groups;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventTimeline({ events, timeBlocks, categories, onEventClick, onAddClick }: Props) {
  const [zoomIdx, setZoomIdx] = useState<number>(1);
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [colorBy, setColorBy] = useState<ColorBy>("category");

  // Scroll sync: header scrolls horizontally with content
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const onContentScroll = () => {
    if (headerScrollRef.current && contentScrollRef.current) {
      headerScrollRef.current.scrollLeft = contentScrollRef.current.scrollLeft;
    }
  };

  const colW     = ZOOM_LEVELS[zoomIdx];
  const zoomPct  = Math.round((colW / 70) * 100);
  const blockW   = timeBlocks.length * colW;
  const gridW    = LABEL_W + blockW;

  const scheduled   = useMemo(() => events.filter((e) => (e.time_block_ids ?? []).length > 0), [events]);
  const unscheduled = useMemo(
    () => [...events.filter((e) => (e.time_block_ids ?? []).length === 0)].sort((a, b) => a.name.localeCompare(b.name)),
    [events],
  );
  const groups     = useMemo(() => buildGroups(scheduled, categories, groupBy), [scheduled, categories, groupBy]);
  const dateGroups = useMemo(() => buildDateGroups(timeBlocks), [timeBlocks]);

  // ── Shared styles ──────────────────────────────────────────────────────────

  const labelCell: React.CSSProperties = {
    width:      LABEL_W,
    flexShrink: 0,
    position:   "sticky",
    left:       0,
    zIndex:     5,
    background: "var(--color-bg)",
    borderRight: "1px solid var(--color-border)",
    display:    "flex",
    alignItems: "center",
    padding:    "0 12px",
    overflow:   "hidden",
  };

  const controlSelect: React.CSSProperties = {
    height:       "30px",
    padding:      "0 8px",
    fontFamily:   "var(--font-sans)",
    fontSize:     "12px",
    color:        "var(--color-text-primary)",
    background:   "var(--color-surface)",
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor:       "pointer",
    outline:      "none",
  };

  const zoomBtnStyle = (disabled: boolean): React.CSSProperties => ({
    width:          "26px",
    height:         "26px",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    fontFamily:     "var(--font-sans)",
    fontSize:       "16px",
    color:          disabled ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
    background:     "var(--color-surface)",
    border:         "1px solid var(--color-border)",
    borderRadius:   "var(--radius-sm)",
    cursor:         disabled ? "not-allowed" : "pointer",
  });

  // ── Controls bar ──────────────────────────────────────────────────────────

  const controls = (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <button style={zoomBtnStyle(zoomIdx === 0)} disabled={zoomIdx === 0}
          onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}>−</button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", minWidth: "38px", textAlign: "center" }}>
          {zoomPct}%
        </span>
        <button style={zoomBtnStyle(zoomIdx === ZOOM_LEVELS.length - 1)} disabled={zoomIdx === ZOOM_LEVELS.length - 1}
          onClick={() => setZoomIdx((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))}>+</button>
      </div>

      <div style={{ width: 1, height: 18, background: "var(--color-border)" }} />

      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} style={controlSelect}>
        <option value="category">Group by category</option>
        <option value="building">Group by building</option>
        <option value="az">A – Z</option>
      </select>

      <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} style={controlSelect}>
        <option value="category">Color by category</option>
        <option value="division">Color by division</option>
        <option value="type">Color by type</option>
      </select>

      <div style={{ flex: 1 }} />

      <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
        {events.length} event{events.length !== 1 ? "s" : ""}
      </span>

      <Button size="sm" onClick={onAddClick}>
        <IconPlus size={12} /> Add event
      </Button>
    </div>
  );

  // ── Empty state ────────────────────────────────────────────────────────────

  if (timeBlocks.length === 0) {
    return (
      <div>
        {controls}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "220px", border: "1px dashed var(--color-border)", borderRadius: "var(--radius-md)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-sans)", fontSize: "13px" }}>
          Add time blocks to see the timeline.
        </div>
      </div>
    );
  }

  // ── Header rows (rendered inside scroll-synced div) ───────────────────────

  const headerRows = (
    <div style={{ width: gridW, display: "flex", flexDirection: "column" }}>
      {/* Date row */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
        <div style={{ width: LABEL_W, flexShrink: 0, height: DATE_ROW_H, position: "sticky", left: 0, zIndex: 15, background: "var(--color-bg)", borderRight: "1px solid var(--color-border)" }} />
        {dateGroups.map((dg) => (
          <div key={dg.date} style={{ width: dg.blockCount * colW, flexShrink: 0, height: DATE_ROW_H, display: "flex", alignItems: "center", padding: "0 8px", overflow: "hidden", borderRight: "1px solid var(--color-border)" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {dg.label}
            </span>
          </div>
        ))}
      </div>

      {/* Block row */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--color-border)", background: "var(--color-bg)" }}>
        <div style={{ width: LABEL_W, flexShrink: 0, height: BLOCK_ROW_H, position: "sticky", left: 0, zIndex: 15, background: "var(--color-bg)", borderRight: "1px solid var(--color-border)" }} />
        {timeBlocks.map((block) => (
          <div key={block.id} style={{ width: colW, flexShrink: 0, height: BLOCK_ROW_H, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 6px", overflow: "hidden", borderRight: "1px solid var(--color-border)" }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {block.label}
            </span>
            {colW >= 110 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                {fmtTime(block.start)}–{fmtTime(block.end)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {controls}

      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "clip" }}>

        {/* ── Sticky header — overflowX hidden, synced by JS ── */}
        <div
          ref={headerScrollRef}
          style={{ position: "sticky", top: 0, zIndex: 10, overflowX: "hidden", borderBottom: "1px solid var(--color-border)" }}
        >
          {headerRows}
        </div>

        {/* ── Scrollable content ── */}
        <div
          ref={contentScrollRef}
          onScroll={onContentScroll}
          style={{ overflowX: "auto" }}
        >
          <div style={{ width: gridW, minWidth: "100%" }}>

            {/* Groups */}
            {groups.map((group, groupIdx) => {
              // Category color for label cell
              let labelBg      = "var(--color-bg)";
              let labelColor   = "var(--color-text-secondary)";
              let labelBorderR = "1px solid var(--color-border)";
              if (groupBy === "category" && group.key !== "null") {
                const catIdx = categories.findIndex((c) => String(c.id) === group.key);
                if (catIdx >= 0) {
                  const cv   = catColorVars(catIdx);
                  labelBg    = cv.subtle;
                  labelColor = cv.text;
                  labelBorderR = `1px solid ${cv.main}`;
                }
              }
              return (
              <div
                key={group.key}
                style={{
                  display:     "flex",
                  borderBottom: "2px solid var(--color-border)",
                  borderTop:   groupIdx > 0 ? "1px solid var(--color-border)" : undefined,
                }}
              >
                {/* Group label — spans all event rows in this group */}
                <div style={{
                  ...labelCell,
                  background:  labelBg,
                  borderRight: labelBorderR,
                  alignItems:  "flex-start",
                  paddingTop:  "10px",
                  minHeight:   group.events.length * ROW_H,
                }}>
                  <span style={{
                    fontFamily:    "var(--font-sans)",
                    fontSize:      "11px",
                    fontWeight:    700,
                    color:         labelColor,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    lineHeight:    1.3,
                    wordBreak:     "break-word",
                    whiteSpace:    "pre-wrap",
                  }}>
                    {group.label}
                  </span>
                </div>

                {/* Event rows */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  {group.events.map((event, idx) => {
                    const runs    = getRuns(event, timeBlocks);
                    const isLast  = idx === group.events.length - 1;
                    const chipLabel = event.division
                      ? `${event.name} ${event.division}`
                      : event.name;
                    return (
                      <div
                        key={event.id}
                        style={{
                          position:     "relative",
                          height:       ROW_H,
                          borderBottom: isLast ? "none" : "1px solid var(--color-border)",
                          minWidth:     blockW,
                        }}
                      >
                        {/* Column separators */}
                        {timeBlocks.map((_, i) => (
                          <div key={i} style={{ position: "absolute", left: (i + 1) * colW - 1, top: 0, bottom: 0, width: 1, background: "var(--color-border)" }} />
                        ))}

                        {/* Chips */}
                        {runs.map((run) => (
                          <EventChip
                            key={run.startIdx}
                            event={{ ...event, name: chipLabel }}
                            categories={categories}
                            colorBy={colorBy}
                            columnWidth={colW}
                            spanCount={run.spanCount}
                            onClick={() => onEventClick(event)}
                            style={{ left: run.startIdx * colW + 4 }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ); })}

            {/* Empty scheduled state */}
            {scheduled.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "160px", gap: "10px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-sans)", fontSize: "13px" }}>
                <span>No scheduled events yet.</span>
                <Button size="sm" onClick={onAddClick}><IconPlus size={12} /> Add event</Button>
              </div>
            )}

            {/* Unscheduled strip */}
            {unscheduled.length > 0 && (
              <div>
                <div style={{ display: "flex", height: 28, borderTop: "2px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                  <div style={{ position: "sticky", left: 0, display: "flex", alignItems: "center", gap: "8px", padding: "0 12px", width: gridW, background: "var(--color-surface)" }}>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Unscheduled ({unscheduled.length})
                    </span>
                  </div>
                </div>

                {unscheduled.map((event) => (
                  <div key={event.id} style={{ display: "flex", height: ROW_H, borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ ...labelCell, cursor: "pointer" }} onClick={() => onEventClick(event)} title={event.name}>
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {event.name}{event.division ? ` ${event.division}` : ""}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: blockW }} />
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
