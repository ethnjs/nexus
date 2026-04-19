"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Event, TimeBlock, TournamentCategory } from "@/lib/api";
import { fmtDate, fmtTime, catColorVars } from "@/lib/formatters";
import { EventChip } from "@/components/events/EventChip";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";

// ─── Constants ────────────────────────────────────────────────────────────────

const ZOOM_LEVELS  = [70, 110, 155, 210] as const;
const LABEL_W      = 160;   // px — sticky left label column
const ROW_H        = 44;    // px — event row height
const DATE_ROW_H   = 26;    // px — top header row
const BLOCK_ROW_H  = 32;    // px — bottom header row
const CONTROLS_H   = 50;    // px — controls bar height (incl. padding)
// Total height of the sticky header (controls + 1px border + date row + block row - 22px padding from main div)
const STICKY_H     = CONTROLS_H + 1 + DATE_ROW_H + BLOCK_ROW_H - 22;

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

// ─── Column layout ────────────────────────────────────────────────────────────

export type ColumnLayout = {
  block:          TimeBlock;
  xOffset:        number;       // left px from start of column grid (excl. label col)
  widthFraction:  number;       // 1.0 for all blocks (each occupies one full colW slot)
  mergedGroupId:  string | null; // non-null when block is part of an overlap group
};

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function blocksOverlap(a: TimeBlock, b: TimeBlock): boolean {
  const s1 = toMinutes(a.start), e1 = toMinutes(a.end);
  const s2 = toMinutes(b.start), e2 = toMinutes(b.end);
  function toRanges(s: number, e: number): [number, number][] {
    return e <= s ? [[s, 1440], [0, e]] : [[s, e]];
  }
  for (const [a1, b1] of toRanges(s1, e1))
    for (const [a2, b2] of toRanges(s2, e2))
      if (a1 < b2 && b1 > a2) return true;
  return false;
}

export function resolveColumnLayout(blocks: TimeBlock[], colW: number): ColumnLayout[] {
  if (blocks.length === 0) return [];

  // Union-find over block IDs to detect transitive overlap groups
  const parent = new Map<number, number>(blocks.map((b) => [b.id, b.id]));

  function find(id: number): number {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let curr = id;
    while (curr !== root) { const next = parent.get(curr)!; parent.set(curr, root); curr = next; }
    return root;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++)
      if (blocks[i].date === blocks[j].date && blocksOverlap(blocks[i], blocks[j]))
        union(blocks[i].id, blocks[j].id);

  const groupSizes = new Map<number, number>();
  for (const b of blocks) {
    const root = find(b.id);
    groupSizes.set(root, (groupSizes.get(root) ?? 0) + 1);
  }

  return blocks.map((block, i) => {
    const root = find(block.id);
    const size = groupSizes.get(root) ?? 1;
    return {
      block,
      xOffset:       i * colW,
      widthFraction: 1.0,
      mergedGroupId: size > 1 ? String(root) : null,
    };
  });
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

function withDateOffsets(dateGroups: DateGroup[], colW: number): Array<DateGroup & { start: number; width: number }> {
  let start = 0;
  const rows: Array<DateGroup & { start: number; width: number }> = [];
  for (const dg of dateGroups) {
    const width = dg.blockCount * colW;
    rows.push({ ...dg, start, width });
    start += width;
  }
  return rows;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventTimeline({ events, timeBlocks, categories, onEventClick, onAddClick }: Props) {
  const [zoomIdx, setZoomIdx] = useState<number>(1);
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [colorBy, setColorBy] = useState<ColorBy>("category");

  // Scroll sync: timeline header rows + body sections track scrollLeft of the active scroller.
  // Controls bar is intentionally excluded so it stays fixed in the x direction.
  const headerRowsScrollRef   = useRef<HTMLDivElement>(null);
  const contentScrollRef      = useRef<HTMLDivElement>(null);
  const unscheduledSubRef     = useRef<HTMLDivElement>(null);
  const unscheduledContentRef = useRef<HTMLDivElement>(null);
  const dateLabelRefs         = useRef<Map<string, HTMLSpanElement>>(new Map());
  const latestScrollLeftRef   = useRef<number>(0);
  const rafRef                = useRef<number | null>(null);

  const syncScroll = (scrollLeft: number) => {
    latestScrollLeftRef.current = scrollLeft;
    for (const ref of [headerRowsScrollRef, contentScrollRef, unscheduledSubRef, unscheduledContentRef]) {
      if (ref.current && ref.current.scrollLeft !== scrollLeft)
        ref.current.scrollLeft = scrollLeft;
    }
    if (rafRef.current === null) {
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        for (const dg of dateGroupsWithOffsets) {
          const label = dateLabelRefs.current.get(dg.date);
          if (!label) continue;
          const labelWidth = label.offsetWidth;
          const maxShift   = Math.max(0, dg.width - 16 - labelWidth);
          const shift      = Math.min(Math.max(0, latestScrollLeftRef.current - dg.start), maxShift);
          label.style.transform = `translateX(${shift}px)`;
        }
      });
    }
  };
  const onContentScroll     = () => syncScroll(contentScrollRef.current?.scrollLeft ?? 0);
  const onUnscheduledScroll = () => syncScroll(unscheduledContentRef.current?.scrollLeft ?? 0);

  const colW    = ZOOM_LEVELS[zoomIdx];
  const zoomPct = Math.round((colW / 70) * 100);
  const blockW  = timeBlocks.length * colW;
  const gridW   = LABEL_W + blockW;

  const scheduled   = useMemo(() => events.filter((e) => (e.time_block_ids ?? []).length > 0), [events]);
  const unscheduled = useMemo(
    () => [...events.filter((e) => (e.time_block_ids ?? []).length === 0)].sort((a, b) => a.name.localeCompare(b.name)),
    [events],
  );
  const groups        = useMemo(() => buildGroups(scheduled, categories, groupBy), [scheduled, categories, groupBy]);
  const dateGroups    = useMemo(() => buildDateGroups(timeBlocks), [timeBlocks]);
  const dateGroupsWithOffsets = withDateOffsets(dateGroups, colW);
  const columnLayout  = useMemo(() => resolveColumnLayout(timeBlocks, colW), [timeBlocks, colW]);

  useEffect(() => {
    const scrollLeft = contentScrollRef.current?.scrollLeft ?? latestScrollLeftRef.current;
    latestScrollLeftRef.current = scrollLeft;
    for (const dg of dateGroupsWithOffsets) {
      const label = dateLabelRefs.current.get(dg.date);
      if (!label) continue;
      const labelWidth = label.offsetWidth;
      const maxShift   = Math.max(0, dg.width - 16 - labelWidth);
      const shift      = Math.min(Math.max(0, scrollLeft - dg.start), maxShift);
      label.style.transform = `translateX(${shift}px)`;
    }
  }, [dateGroupsWithOffsets]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Pre-build a map from mergedGroupId → all blocks in that group (for tooltips)
  const mergedGroupBlocks = useMemo(() => {
    const map = new Map<string, TimeBlock[]>();
    for (const col of columnLayout) {
      if (col.mergedGroupId) {
        if (!map.has(col.mergedGroupId)) map.set(col.mergedGroupId, []);
        map.get(col.mergedGroupId)!.push(col.block);
      }
    }
    return map;
  }, [columnLayout]);

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

  // ── Controls bar (lives inside the sticky header) ─────────────────────────

  const controlsBar = (
    <div style={{
      height:        CONTROLS_H,
      display:       "flex",
      alignItems:    "center",
      gap:           "10px",
      padding:       "0 12px",
      borderBottom:  "1px solid var(--color-border)",
      background:    "var(--color-bg)",
      flexShrink:    0,
    }}>
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
    </div>
  );

  // ── Header rows (date + block, rendered inside scroll-synced div) ─────────

  const headerRows = (
    <div style={{ width: gridW, display: "flex", flexDirection: "column" }}>
      {/* Date row */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
        <div style={{ width: LABEL_W, flexShrink: 0, height: DATE_ROW_H, position: "sticky", left: 0, zIndex: 15, background: "var(--color-bg)", borderRight: "1px solid var(--color-border)" }} />
        {dateGroupsWithOffsets.map((dg) => {
          return (
            <div key={dg.date} style={{ width: dg.width, flexShrink: 0, height: DATE_ROW_H, display: "flex", alignItems: "center", padding: "0 8px", overflow: "hidden", borderRight: "1px solid var(--color-border)" }}>
              <span
                ref={(el) => {
                  if (el) dateLabelRefs.current.set(dg.date, el);
                  else dateLabelRefs.current.delete(dg.date);
                }}
                style={{ display: "inline-block", transform: "translateX(0px)", willChange: "transform", fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(100% - 8px)" }}
              >
                {dg.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Block row */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--color-border)", background: "var(--color-bg)" }}>
        <div style={{ width: LABEL_W, flexShrink: 0, height: BLOCK_ROW_H, position: "sticky", left: 0, zIndex: 15, background: "var(--color-bg)", borderRight: "1px solid var(--color-border)" }} />
        {columnLayout.map((col) => {
          const groupBlocks = col.mergedGroupId ? (mergedGroupBlocks.get(col.mergedGroupId) ?? []) : [];
          const tooltip = col.mergedGroupId
            ? groupBlocks.map((b) => `${b.label} (${fmtTime(b.start)}–${fmtTime(b.end)})`).join(" and ") + " overlap"
            : undefined;
          return (
            <div
              key={col.block.id}
              title={tooltip}
              style={{
                width:           colW,
                flexShrink:      0,
                height:          BLOCK_ROW_H,
                display:         "flex",
                flexDirection:   "column",
                justifyContent:  "center",
                padding:         "0 6px",
                overflow:        "hidden",
                borderRight:     "1px solid var(--color-border)",
                background:      col.mergedGroupId ? "#FAEEDA" : undefined,
              }}
            >
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {col.block.label}
              </span>
              {colW >= 110 && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                  {fmtTime(col.block.start)}–{fmtTime(col.block.end)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Shared outer container style ───────────────────────────────────────────

  const outerStyle: React.CSSProperties = {
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    overflow:     "clip",
  };

  // ── Empty state ────────────────────────────────────────────────────────────

  if (timeBlocks.length === 0) {
    return (
      <div style={outerStyle}>
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--color-bg)" }}>
          {controlsBar}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "220px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-sans)", fontSize: "13px" }}>
          Add time blocks to see the timeline.
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={outerStyle}>

      {/* ── Sticky top controls: fixed x, sticky y ── */}
      <div
        style={{ position: "sticky", top: "-22px", zIndex: 21, background: "var(--color-bg)" }}
      >
        {controlsBar}
      </div>

      {/* ── Sticky timeline header rows: scroll-synced on x, sticky on y ── */}
      <div
        ref={headerRowsScrollRef}
        style={{ position: "sticky", top: `${CONTROLS_H - 22}px`, zIndex: 20, overflowX: "hidden", background: "var(--color-bg)" }}
      >
        {headerRows}
      </div>

      {/* ── Scrollable content: scheduled groups ── */}
      <div
        ref={contentScrollRef}
        onScroll={onContentScroll}
        style={{ overflowX: "auto" }}
      >
        <div style={{ width: gridW, minWidth: "100%" }}>

          {/* Groups */}
          {groups.map((group, groupIdx) => {
            let labelBg      = "var(--color-bg)";
            let labelColor   = "var(--color-text-secondary)";
            let labelBorderR = "1px solid var(--color-border)";
            if (groupBy === "category" && group.key !== "null") {
              const catIdx = categories.findIndex((c) => String(c.id) === group.key);
              if (catIdx >= 0) {
                const cv     = catColorVars(catIdx);
                labelBg      = cv.subtle;
                labelColor   = cv.text;
                labelBorderR = `1px solid ${cv.main}`;
              }
            }
            return (
              <div
                key={group.key}
                style={{
                  display:      "flex",
                  borderBottom: "2px solid var(--color-border)",
                  borderTop:    groupIdx > 0 ? "1px solid var(--color-border)" : undefined,
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
                    const runs      = getRuns(event, timeBlocks);
                    const isLast    = idx === group.events.length - 1;
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
            );
          })}

          {/* Empty scheduled state */}
          {scheduled.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "160px", gap: "10px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-sans)", fontSize: "13px" }}>
              <span>No scheduled events yet.</span>
              <Button size="sm" onClick={onAddClick}><IconPlus size={12} /> Add event</Button>
            </div>
          )}

        </div>
      </div>

      {/* ── Unscheduled section ── */}
      {unscheduled.length > 0 && (
        <>
          {/* Sticky subheader — lifted out of the overflow-x:auto content div so vertical sticky works */}
          <div
            ref={unscheduledSubRef}
            style={{
              position:     "sticky",
              top:          STICKY_H,
              zIndex:       15,
              overflowX:    "hidden",
              borderTop:    "2px solid var(--color-border)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div style={{ width: gridW, height: 28, background: "var(--color-surface)", display: "flex", alignItems: "center" }}>
              <div style={{ position: "sticky", left: 0, display: "flex", alignItems: "center", padding: "0 12px", background: "var(--color-surface)" }}>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Unscheduled ({unscheduled.length})
                </span>
              </div>
            </div>
          </div>

          {/* Unscheduled rows — own scroll-synced container */}
          <div
            ref={unscheduledContentRef}
            onScroll={onUnscheduledScroll}
            style={{ overflowX: "auto" }}
          >
            <div style={{ width: gridW, minWidth: "100%" }}>
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
          </div>
        </>
      )}

    </div>
  );
}
