"use client";

import { useMemo, useState } from "react";
import { Event, TimeBlock, TournamentCategory } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/formatters";
import { EventChip } from "@/components/events/EventChip";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";

// ─── Constants ────────────────────────────────────────────────────────────────

const ZOOM_LEVELS = [70, 110, 155, 210] as const;
const LABEL_W     = 160;   // px — sticky left label column width
const ROW_H       = 44;    // px — event row height
const DATE_ROW_H  = 26;    // px — top header row (date groups)
const BLOCK_ROW_H = 32;    // px — bottom header row (block labels)

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
    return [{ key: "all", label: "", events: [...events].sort((a, b) => a.name.localeCompare(b.name)) }];
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
    .map((g) => ({ ...g, events: g.events.sort((a, b) => a.name.localeCompare(b.name)) }))
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

// ─── Shared cell styles ───────────────────────────────────────────────────────

const borderR: React.CSSProperties = { borderRight: "1px solid var(--color-border)" };
const borderB: React.CSSProperties = { borderBottom: "1px solid var(--color-border)" };

// ─── Component ────────────────────────────────────────────────────────────────

export function EventTimeline({ events, timeBlocks, categories, onEventClick, onAddClick }: Props) {
  const [zoomIdx,  setZoomIdx]  = useState<number>(1);           // default 110px
  const [groupBy,  setGroupBy]  = useState<GroupBy>("category");
  const [colorBy,  setColorBy]  = useState<ColorBy>("category");

  const colW = ZOOM_LEVELS[zoomIdx];
  const zoomPct = Math.round((colW / 70) * 100);

  const scheduled   = useMemo(() => events.filter((e) => (e.time_block_ids ?? []).length > 0), [events]);
  const unscheduled = useMemo(() => events.filter((e) => (e.time_block_ids ?? []).length === 0)
    .sort((a, b) => a.name.localeCompare(b.name)), [events]);

  const groups     = useMemo(() => buildGroups(scheduled, categories, groupBy), [scheduled, categories, groupBy]);
  const dateGroups = useMemo(() => buildDateGroups(timeBlocks), [timeBlocks]);

  const gridW = LABEL_W + timeBlocks.length * colW;

  // ── Shared sub-styles ──────────────────────────────────────────────────────

  const labelCell: React.CSSProperties = {
    width:        LABEL_W,
    flexShrink:   0,
    position:     "sticky",
    left:         0,
    zIndex:       5,
    background:   "var(--color-bg)",
    display:      "flex",
    alignItems:   "center",
    padding:      "0 12px",
    overflow:     "hidden",
    ...borderR,
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

  const zoomBtn = (disabled: boolean): React.CSSProperties => ({
    width:        "26px",
    height:       "26px",
    display:      "flex",
    alignItems:   "center",
    justifyContent: "center",
    fontFamily:   "var(--font-sans)",
    fontSize:     "16px",
    fontWeight:   400,
    color:        disabled ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
    background:   "var(--color-surface)",
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor:       disabled ? "not-allowed" : "pointer",
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  if (timeBlocks.length === 0) {
    return (
      <div>
        <ControlsBar
          zoomIdx={zoomIdx} setZoomIdx={setZoomIdx}
          zoomPct={zoomPct} groupBy={groupBy} setGroupBy={setGroupBy}
          colorBy={colorBy} setColorBy={setColorBy}
          eventCount={events.length}
          onAddClick={onAddClick}
          controlSelect={controlSelect} zoomBtn={zoomBtn}
        />
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          height:         "220px",
          border:         "1px dashed var(--color-border)",
          borderRadius:   "var(--radius-md)",
          color:          "var(--color-text-tertiary)",
          fontFamily:     "var(--font-sans)",
          fontSize:       "13px",
        }}>
          Add time blocks to see the timeline.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Controls bar ── */}
      <ControlsBar
        zoomIdx={zoomIdx} setZoomIdx={setZoomIdx}
        zoomPct={zoomPct} groupBy={groupBy} setGroupBy={setGroupBy}
        colorBy={colorBy} setColorBy={setColorBy}
        eventCount={events.length}
        onAddClick={onAddClick}
        controlSelect={controlSelect} zoomBtn={zoomBtn}
      />

      {/* ── Scrollable grid ── */}
      <div style={{
        overflowX:    "auto",
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
      }}>
        <div style={{ width: gridW, minWidth: "100%" }}>

          {/* ── Sticky two-row header ── */}
          <div style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", flexDirection: "column" }}>

            {/* Date row */}
            <div style={{ display: "flex", ...borderB, background: "var(--color-bg)" }}>
              <div style={{ width: LABEL_W, flexShrink: 0, height: DATE_ROW_H, position: "sticky", left: 0, zIndex: 15, background: "var(--color-bg)", ...borderR }} />
              {dateGroups.map((dg) => (
                <div
                  key={dg.date}
                  style={{
                    width:      dg.blockCount * colW,
                    flexShrink: 0,
                    height:     DATE_ROW_H,
                    overflow:   "hidden",
                    display:    "flex",
                    alignItems: "center",
                    padding:    "0 8px",
                    ...borderR,
                  }}
                >
                  <span style={{
                    fontFamily:    "var(--font-sans)",
                    fontSize:      "11px",
                    fontWeight:    600,
                    color:         "var(--color-text-secondary)",
                    whiteSpace:    "nowrap",
                    overflow:      "hidden",
                    textOverflow:  "ellipsis",
                  }}>
                    {dg.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Block row */}
            <div style={{ display: "flex", borderBottom: "2px solid var(--color-border)", background: "var(--color-bg)" }}>
              <div style={{ width: LABEL_W, flexShrink: 0, height: BLOCK_ROW_H, position: "sticky", left: 0, zIndex: 15, background: "var(--color-bg)", ...borderR }} />
              {timeBlocks.map((block) => (
                <div
                  key={block.id}
                  style={{
                    width:         colW,
                    flexShrink:    0,
                    height:        BLOCK_ROW_H,
                    display:       "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    padding:       "0 6px",
                    overflow:      "hidden",
                    ...borderR,
                  }}
                >
                  <span style={{
                    fontFamily:   "var(--font-sans)",
                    fontSize:     "11px",
                    fontWeight:   600,
                    color:        "var(--color-text-primary)",
                    whiteSpace:   "nowrap",
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {block.label}
                  </span>
                  {colW >= 110 && (
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize:   "10px",
                      color:      "var(--color-text-tertiary)",
                      whiteSpace: "nowrap",
                    }}>
                      {fmtTime(block.start)}–{fmtTime(block.end)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Scheduled groups ── */}
          {groups.map((group) => (
            <div key={group.key}>

              {/* Group header row */}
              {groupBy !== "az" && (
                <div style={{
                  display:    "flex",
                  height:     28,
                  background: "var(--color-surface)",
                  ...borderB,
                }}>
                  <div style={{
                    position:   "sticky",
                    left:       0,
                    display:    "flex",
                    alignItems: "center",
                    padding:    "0 12px",
                    width:      gridW,
                    background: "var(--color-surface)",
                  }}>
                    <span style={{
                      fontFamily:    "var(--font-sans)",
                      fontSize:      "10px",
                      fontWeight:    700,
                      color:         "var(--color-text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}>
                      {group.label}
                    </span>
                  </div>
                </div>
              )}

              {/* Event rows */}
              {group.events.map((event) => {
                const runs = getRuns(event, timeBlocks);
                return (
                  <div
                    key={event.id}
                    style={{ display: "flex", height: ROW_H, ...borderB }}
                  >
                    {/* Label */}
                    <div
                      style={labelCell}
                      title={event.name}
                    >
                      <span style={{
                        fontFamily:   "var(--font-sans)",
                        fontSize:     "12px",
                        color:        "var(--color-text-primary)",
                        whiteSpace:   "nowrap",
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {event.name}
                      </span>
                    </div>

                    {/* Block area */}
                    <div style={{
                      position: "relative",
                      flex:     1,
                      minWidth: timeBlocks.length * colW,
                    }}>
                      {/* Column separators */}
                      {timeBlocks.map((_, i) => (
                        <div
                          key={i}
                          style={{
                            position:   "absolute",
                            left:       (i + 1) * colW - 1,
                            top:        0,
                            bottom:     0,
                            width:      1,
                            background: "var(--color-border)",
                          }}
                        />
                      ))}

                      {/* Chips */}
                      {runs.map((run) => (
                        <EventChip
                          key={run.startIdx}
                          event={event}
                          categories={categories}
                          colorBy={colorBy}
                          columnWidth={colW}
                          spanCount={run.spanCount}
                          onClick={() => onEventClick(event)}
                          style={{ left: run.startIdx * colW + 4 }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* ── Unscheduled strip ── */}
          {unscheduled.length > 0 && (
            <div>
              <div style={{
                display:      "flex",
                height:       28,
                borderTop:    "2px solid var(--color-border)",
                ...borderB,
                background:   "var(--color-surface)",
              }}>
                <div style={{
                  position:   "sticky",
                  left:       0,
                  display:    "flex",
                  alignItems: "center",
                  gap:        "8px",
                  padding:    "0 12px",
                  width:      gridW,
                  background: "var(--color-surface)",
                }}>
                  <span style={{
                    fontFamily:    "var(--font-sans)",
                    fontSize:      "10px",
                    fontWeight:    700,
                    color:         "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}>
                    Unscheduled ({unscheduled.length})
                  </span>
                </div>
              </div>

              {unscheduled.map((event) => (
                <div
                  key={event.id}
                  style={{ display: "flex", height: ROW_H, ...borderB }}
                >
                  <div style={{ ...labelCell, cursor: "pointer" }} onClick={() => onEventClick(event)} title={event.name}>
                    <span style={{
                      fontFamily:   "var(--font-sans)",
                      fontSize:     "12px",
                      color:        "var(--color-text-tertiary)",
                      fontStyle:    "italic",
                      whiteSpace:   "nowrap",
                      overflow:     "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {event.name}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: timeBlocks.length * colW }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty scheduled state */}
          {scheduled.length === 0 && (
            <div style={{
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              justifyContent: "center",
              height:         "180px",
              gap:            "10px",
              color:          "var(--color-text-tertiary)",
              fontFamily:     "var(--font-sans)",
              fontSize:       "13px",
            }}>
              <span>No scheduled events yet.</span>
              <Button size="sm" onClick={onAddClick}>
                <IconPlus size={12} /> Add event
              </Button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Controls bar (extracted to keep render clean) ────────────────────────────

function ControlsBar({
  zoomIdx, setZoomIdx, zoomPct,
  groupBy, setGroupBy,
  colorBy, setColorBy,
  eventCount, onAddClick,
  controlSelect, zoomBtn,
}: {
  zoomIdx:       number;
  setZoomIdx:    (n: number) => void;
  zoomPct:       number;
  groupBy:       GroupBy;
  setGroupBy:    (g: GroupBy) => void;
  colorBy:       ColorBy;
  setColorBy:    (c: ColorBy) => void;
  eventCount:    number;
  onAddClick:    () => void;
  controlSelect: React.CSSProperties;
  zoomBtn:       (disabled: boolean) => React.CSSProperties;
}) {
  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          "10px",
      marginBottom: "12px",
      flexWrap:     "wrap",
    }}>
      {/* Zoom controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <button
          style={zoomBtn(zoomIdx === 0)}
          onClick={() => setZoomIdx(Math.max(0, zoomIdx - 1))}
          disabled={zoomIdx === 0}
        >
          −
        </button>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize:   "12px",
          color:      "var(--color-text-secondary)",
          minWidth:   "38px",
          textAlign:  "center",
        }}>
          {zoomPct}%
        </span>
        <button
          style={zoomBtn(zoomIdx === ZOOM_LEVELS.length - 1)}
          onClick={() => setZoomIdx(Math.min(ZOOM_LEVELS.length - 1, zoomIdx + 1))}
          disabled={zoomIdx === ZOOM_LEVELS.length - 1}
        >
          +
        </button>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: "var(--color-border)" }} />

      {/* Group by */}
      <select
        value={groupBy}
        onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        style={controlSelect}
      >
        <option value="category">Group by category</option>
        <option value="building">Group by building</option>
        <option value="az">A – Z</option>
      </select>

      {/* Color by */}
      <select
        value={colorBy}
        onChange={(e) => setColorBy(e.target.value as ColorBy)}
        style={controlSelect}
      >
        <option value="category">Color by category</option>
        <option value="division">Color by division</option>
        <option value="type">Color by type</option>
      </select>

      <div style={{ flex: 1 }} />

      <span style={{
        fontFamily: "var(--font-sans)",
        fontSize:   "12px",
        color:      "var(--color-text-tertiary)",
        whiteSpace: "nowrap",
      }}>
        {eventCount} event{eventCount !== 1 ? "s" : ""}
      </span>

      <Button size="sm" onClick={onAddClick}>
        <IconPlus size={12} />
        Add event
      </Button>
    </div>
  );
}
