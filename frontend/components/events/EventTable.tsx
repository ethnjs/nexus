"use client";

import { useState, useRef, useEffect, useMemo, useCallback, CSSProperties } from "react";
import { Event, EventCreate, TimeBlock, TournamentCategory } from "@/lib/api";
import { catColorVars, fmtTime, fmtDateShort } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";
import { IconPlus, IconSearch } from "@/components/ui/Icons";

// ─── Types ────────────────────────────────────────────────────────────────────

type TextCol    = "name" | "building" | "room" | "floor";
type NumCol     = "volunteers_needed";
type DivFilter  = "B" | "C" | null;
type TypeFilter = "standard" | "trial" | null;

const COL_W = {
  select: 40,
  name: 220,
  category: 200,
  division: 90,
  type: 90,
  building: 150,
  room: 200,
  floor: 70,
  volunteers: 90,
  timeBlocks: 800,
} as const;

interface Props {
  events:             Event[];
  categories:         TournamentCategory[];
  timeBlocks:         TimeBlock[];
  onUpdate:           (id: number, delta: Partial<EventCreate>) => Promise<void>;
  onCreateCategory:   (name: string) => Promise<TournamentCategory>;
  onAddClick:         () => void;
  isReadOnly?:          boolean;
  selectMode?:          boolean;
  selectedIds?:         Set<number>;
  onToggleSelect?:      (id: number) => void;
  onEnterSelectMode?:   () => void;
  onFilteredIdsChange?: (ids: number[]) => void;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const cell: CSSProperties = {
  padding:         "0 10px",
  height:          "40px",
  verticalAlign:   "middle",
  borderBottom:    "1px solid var(--color-border)",
  whiteSpace:      "nowrap",
  overflow:        "hidden",
  textOverflow:    "ellipsis",
};

const cellText: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize:   "12px",
  color:      "var(--color-text-primary)",
};

const inputStyle: CSSProperties = {
  width:        "100%",
  height:       "28px",
  padding:      "0 6px",
  fontFamily:   "var(--font-mono)",
  fontSize:     "12px",
  color:        "var(--color-text-primary)",
  background:   "var(--color-surface)",
  border:       "1px solid var(--color-accent)",
  borderRadius: "var(--radius-sm)",
  outline:      "none",
  boxSizing:    "border-box",
};

// ─── DivisionCell ─────────────────────────────────────────────────────────────

function DivisionCell({
  value,
  onCommit,
  isReadOnly,
}: {
  value:       "B" | "C" | null;
  onCommit:    (v: "B" | "C" | null) => void;
  isReadOnly?: boolean;
}) {
  const opts: ("B" | "C" | null)[] = ["B", "C", null];
  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {opts.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={String(opt)}
            onClick={() => !isReadOnly && onCommit(opt)}
            style={{
              fontFamily:   "var(--font-sans)",
              fontSize:     "11px",
              fontWeight:   active ? 600 : 400,
              color:        active ? "var(--color-text-inverse)" : "var(--color-text-tertiary)",
              background:   active ? "var(--color-accent)" : "transparent",
              border:       "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              padding:      "2px 6px",
              cursor:       isReadOnly ? "default" : "pointer",
              transition:   "background var(--transition-fast)",
            }}
          >
            {opt ?? "—"}
          </button>
        );
      })}
    </div>
  );
}

// ─── TypeCell ─────────────────────────────────────────────────────────────────

function TypeCell({
  value,
  onToggle,
  isReadOnly,
}: {
  value:       "standard" | "trial";
  onToggle:    () => void;
  isReadOnly?: boolean;
}) {
  const isTrial = value === "trial";
  return (
    <button
      onClick={() => !isReadOnly && onToggle()}
      title={isTrial ? "Click to set Standard" : "Click to set Trial"}
      style={{
        fontFamily:   "var(--font-sans)",
        fontSize:     "11px",
        fontWeight:   500,
        color:        isTrial ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
        background:   isTrial ? "var(--color-type-trial)" : "transparent",
        border:       `1px solid ${isTrial ? "var(--color-type-trial)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-sm)",
        padding:      "2px 7px",
        cursor:       isReadOnly ? "default" : "pointer",
        transition:   "background var(--transition-fast), border-color var(--transition-fast)",
      }}
    >
      {isTrial ? "Trial" : "Standard"}
    </button>
  );
}

// ─── CategoryCell ─────────────────────────────────────────────────────────────

function CategoryCell({
  value,
  categories,
  onCommit,
  onCreateCategory,
  isReadOnly,
}: {
  value:            number | null;
  categories:       TournamentCategory[];
  onCommit:         (id: number | null) => Promise<void>;
  onCreateCategory: (name: string) => Promise<TournamentCategory>;
  isReadOnly?:      boolean;
}) {
  const [open,         setOpen]         = useState(false);
  const [creating,     setCreating]     = useState(false);
  const [newName,      setNewName]      = useState("");
  const [saving,       setSaving]       = useState(false);
  // optimistic: undefined = use prop value, anything else = pending commit
  const [optimistic,   setOptimistic]   = useState<number | null | undefined>(undefined);
  const ref      = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 30);
  }, [creating]);

  useEffect(() => {
    if (!open) { setCreating(false); setNewName(""); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Clear optimistic once the prop catches up
  useEffect(() => {
    setOptimistic(undefined);
  }, [value]);

  const displayValue = optimistic !== undefined ? optimistic : value;
  const cat    = categories.find((c) => c.id === displayValue);
  const catIdx = cat ? categories.indexOf(cat) : -1;
  const cv     = catIdx >= 0 ? catColorVars(catIdx) : null;

  const handleSelect = async (id: number | null) => {
    setOpen(false);
    setOptimistic(id);
    try {
      await onCommit(id);
    } catch {
      setOptimistic(undefined); // revert on failure
    }
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const created = await onCreateCategory(trimmed);
      setOpen(false);
      await onCommit(created.id);
    } finally {
      setSaving(false);
      setNewName("");
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => !isReadOnly && setOpen((o) => !o)}
        style={{
          fontFamily:   "var(--font-sans)",
          fontSize:     "11px",
          fontWeight:   cat ? 500 : 400,
          color:        cv ? cv.text : "var(--color-text-tertiary)",
          background:   cv ? cv.subtle : "transparent",
          border:       `1px solid ${cv ? cv.main : "var(--color-border)"}`,
          borderRadius: "var(--radius-sm)",
          padding:      "2px 7px",
          cursor:       isReadOnly ? "default" : "pointer",
          maxWidth:     "180px",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}
      >
        {cat ? cat.name : "—"}
      </button>

      {open && (
        <div
          style={{
            position:     "absolute",
            top:          "calc(100% + 4px)",
            left:         0,
            zIndex:       200,
            minWidth:     "160px",
            background:   "var(--color-surface)",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow:    "0 4px 12px rgba(0,0,0,0.12)",
            overflow:     "hidden",
          }}
        >
          {/* No category option */}
          <button
            onClick={() => handleSelect(null)}
            style={{
              display:    "block",
              width:      "100%",
              textAlign:  "left",
              padding:    "7px 10px",
              fontFamily: "var(--font-sans)",
              fontSize:   "12px",
              color:      displayValue === null ? "var(--color-accent)" : "var(--color-text-secondary)",
              background: displayValue === null ? "var(--color-accent-subtle)" : "transparent",
              border:     "none",
              cursor:     "pointer",
            }}
          >
            No category
          </button>

          {categories.length > 0 && (
            <div style={{ borderTop: "1px solid var(--color-border)" }} />
          )}

          {categories.map((c, idx) => {
            const cv2   = catColorVars(idx);
            const active = c.id === displayValue;
            return (
              <button
                key={c.id}
                onClick={() => handleSelect(c.id)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = cv2.subtle;
                  (e.currentTarget as HTMLButtonElement).style.color      = cv2.text;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = active ? cv2.subtle : "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color      = active ? cv2.text : "var(--color-text-primary)";
                }}
                style={{
                  display:    "block",
                  width:      "100%",
                  textAlign:  "left",
                  padding:    "7px 10px",
                  fontFamily: "var(--font-sans)",
                  fontSize:   "12px",
                  color:      active ? cv2.text : "var(--color-text-primary)",
                  background: active ? cv2.subtle : "transparent",
                  border:     "none",
                  cursor:     "pointer",
                  transition: "background var(--transition-fast), color var(--transition-fast)",
                }}
              >
                {c.name}
              </button>
            );
          })}

          <div style={{ borderTop: "1px solid var(--color-border)" }} />

          {creating ? (
            <div style={{ padding: "6px 8px", display: "flex", gap: "4px" }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")  handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="Category name"
                style={{
                  flex:         1,
                  height:       "26px",
                  padding:      "0 6px",
                  fontFamily:   "var(--font-sans)",
                  fontSize:     "12px",
                  border:       "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  outline:      "none",
                  background:   "var(--color-surface)",
                  color:        "var(--color-text-primary)",
                  boxSizing:    "border-box",
                }}
              />
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                style={{
                  height:       "26px",
                  padding:      "0 8px",
                  fontFamily:   "var(--font-sans)",
                  fontSize:     "11px",
                  fontWeight:   600,
                  color:        "var(--color-text-inverse)",
                  background:   "var(--color-accent)",
                  border:       "none",
                  borderRadius: "var(--radius-sm)",
                  cursor:       saving || !newName.trim() ? "not-allowed" : "pointer",
                  opacity:      saving || !newName.trim() ? 0.5 : 1,
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              style={{
                display:    "block",
                width:      "100%",
                textAlign:  "left",
                padding:    "7px 10px",
                fontFamily: "var(--font-sans)",
                fontSize:   "12px",
                color:      "var(--color-accent)",
                background: "transparent",
                border:     "none",
                cursor:     "pointer",
              }}
            >
              + New category
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TimeBlocksCell ───────────────────────────────────────────────────────────

function TimeBlocksCell({
  event,
  timeBlocks,
  onRemove,
  onAdd,
  isReadOnly,
}: {
  event:       Event;
  timeBlocks:  TimeBlock[];
  onRemove:    (blockId: number) => Promise<void>;
  onAdd:       (blockId: number) => Promise<void>;
  isReadOnly?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const ids       = event.time_block_ids ?? [];
  const assigned  = timeBlocks.filter((b) => ids.includes(b.id));
  const available = timeBlocks.filter((b) => !ids.includes(b.id));

  return (
    <div
      ref={ref}
      style={{
        display:    "flex",
        flexWrap:   "wrap",
        gap:        "4px",
        alignItems: "center",
        position:   "relative",
      }}
    >
      {assigned.map((b) => (
        <span
          key={b.id}
          style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          "3px",
            fontFamily:   "var(--font-mono)",
            fontSize:     "11px",
            color:        "var(--color-text-secondary)",
            background:   "var(--color-surface)",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding:      "2px 5px",
          }}
        >
          {b.label}
          {!isReadOnly && (
            <button
              onClick={() => onRemove(b.id)}
              style={{
                display:    "flex",
                background: "none",
                border:     "none",
                padding:    "0 1px",
                cursor:     "pointer",
                color:      "var(--color-text-tertiary)",
                lineHeight: 1,
                fontSize:   "13px",
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}

      {!isReadOnly && available.length > 0 && (
        <button
          onClick={() => setPickerOpen((o) => !o)}
          title="Add time block"
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            width:          "20px",
            height:         "20px",
            background:     "transparent",
            border:         "1px dashed var(--color-border)",
            borderRadius:   "var(--radius-sm)",
            cursor:         "pointer",
            color:          "var(--color-text-tertiary)",
            fontSize:       "14px",
            lineHeight:     1,
            flexShrink:     0,
          }}
        >
          +
        </button>
      )}

      {assigned.length === 0 && isReadOnly && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize:   "11px",
            color:      "var(--color-text-tertiary)",
            fontStyle:  "italic",
          }}
        >
          Unscheduled
        </span>
      )}

      {pickerOpen && (
        <div
          style={{
            position:     "absolute",
            top:          "calc(100% + 4px)",
            left:         0,
            zIndex:       200,
            minWidth:     "220px",
            maxHeight:    "200px",
            overflowY:    "auto",
            background:   "var(--color-surface)",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow:    "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          {available.map((b) => (
            <button
              key={b.id}
              onClick={() => onAdd(b.id)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-accent-subtle)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              style={{
                display:    "block",
                width:      "100%",
                textAlign:  "left",
                padding:    "7px 10px",
                fontFamily: "var(--font-mono)",
                fontSize:   "12px",
                color:      "var(--color-text-primary)",
                background: "transparent",
                border:     "none",
                cursor:     "pointer",
                transition: "background var(--transition-fast)",
              }}
            >
              {b.label} · {fmtDateShort(b.date)} {fmtTime(b.start)}–{fmtTime(b.end)}
            </button>
          ))}
          {available.length === 0 && (
            <div style={{
              padding:    "7px 10px",
              fontFamily: "var(--font-sans)",
              fontSize:   "12px",
              color:      "var(--color-text-tertiary)",
              fontStyle:  "italic",
            }}>
              All blocks assigned
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EventTableRow ────────────────────────────────────────────────────────────

function EventTableRow({
  event,
  categories,
  timeBlocks,
  onUpdate,
  onCreateCategory,
  isReadOnly,
  selectMode,
  selected,
  onToggleSelect,
}: {
  event:            Event;
  categories:       TournamentCategory[];
  timeBlocks:       TimeBlock[];
  onUpdate:         (id: number, delta: Partial<EventCreate>) => Promise<void>;
  onCreateCategory: (name: string) => Promise<TournamentCategory>;
  isReadOnly?:      boolean;
  selectMode?:      boolean;
  selected?:        boolean;
  onToggleSelect?:  () => void;
}) {
  const [editing,  setEditing]  = useState<{ col: TextCol | NumCol; draft: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickyNameLeft = selectMode ? COL_W.select : 0;

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.select(), 10);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.col]);

  const activateText = (col: TextCol | NumCol, current: string | number | null) => {
    if (isReadOnly) return;
    setEditing({ col, draft: String(current ?? "") });
  };

  const commitText = async () => {
    if (!editing) return;
    const { col, draft } = editing;
    setEditing(null);
    const trimmed = draft.trim();
    const current = String(event[col] ?? "");
    if (trimmed === current) return;
    if (col === "volunteers_needed") {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1) await onUpdate(event.id, { volunteers_needed: num });
    } else {
      await onUpdate(event.id, { [col]: trimmed || null });
    }
  };

  const revert = () => setEditing(null);

  const renderTextCell = (
    col: TextCol | NumCol,
    width: number | "auto",
    stickyLeft?: number,
  ) => {
    const isActive   = editing?.col === col;
    const rawVal     = event[col];
    const displayVal = rawVal != null ? String(rawVal) : "";

    return (
      <td
        key={col}
        onClick={() => !isActive && activateText(col, rawVal)}
        style={{
          ...cell,
          width,
          cursor:        isReadOnly || isActive ? "default" : "text",
          paddingLeft:   10,
          paddingRight:  10,
          overflow:      isActive ? "visible" : "hidden",
          ...(stickyLeft !== undefined
            ? {
                position: "sticky",
                left: stickyLeft,
                zIndex: 5,
                background: "inherit",
                boxShadow: "inset -1px 0 0 var(--color-border)",
              }
            : {}),
        }}
      >
        {isActive ? (
          <input
            ref={inputRef}
            type={col === "volunteers_needed" ? "number" : "text"}
            min={col === "volunteers_needed" ? 1 : undefined}
            value={editing!.draft}
            onChange={(e) => setEditing((s) => s ? { ...s, draft: e.target.value } : null)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter")  e.currentTarget.blur();
              if (e.key === "Escape") revert();
            }}
            style={inputStyle}
          />
        ) : (
          <span
            style={{
              ...cellText,
              color: displayVal ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            }}
          >
            {displayVal || "—"}
          </span>
        )}
      </td>
    );
  };

  return (
    <tr
      onClick={selectMode ? onToggleSelect : undefined}
      style={{
        background: selected ? "var(--color-accent-subtle)" : "var(--color-surface)",
        cursor:     selectMode ? "pointer" : "default",
        transition: "background var(--transition-fast)",
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLTableRowElement).style.background = "var(--color-accent-subtle)"; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLTableRowElement).style.background = "var(--color-surface)"; }}
    >
      {/* Checkbox cell in select mode */}
      {selectMode && (
        <td
          style={{
            ...cell,
            width: COL_W.select,
            textAlign: "center",
            padding: "0 8px",
            position: "sticky",
            left: 0,
            zIndex: 6,
            background: "inherit",
            boxShadow: "inset -1px 0 0 var(--color-border)",
          }}
        >
          <div style={{
            display:        "inline-flex",
            alignItems:     "center",
            justifyContent: "center",
            width:          "16px",
            height:         "16px",
            borderRadius:   "3px",
            border:         `2px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
            background:     selected ? "var(--color-accent)" : "var(--color-surface)",
            flexShrink:     0,
          }}>
            {selected && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </td>
      )}

      {renderTextCell("name",              COL_W.name, stickyNameLeft)}

      <td style={{ ...cell, width: COL_W.category, overflow: "visible" }}>
        <CategoryCell
          value={event.category_id}
          categories={categories}
          onCommit={(id) => onUpdate(event.id, { category_id: id })}
          onCreateCategory={onCreateCategory}
          isReadOnly={isReadOnly}
        />
      </td>

      <td style={{ ...cell, width: COL_W.division }}>
        <DivisionCell
          value={event.division}
          onCommit={(div) => onUpdate(event.id, { division: div })}
          isReadOnly={isReadOnly}
        />
      </td>

      <td style={{ ...cell, width: COL_W.type }}>
        <TypeCell
          value={event.event_type}
          onToggle={() => onUpdate(event.id, { event_type: event.event_type === "standard" ? "trial" : "standard" })}
          isReadOnly={isReadOnly}
        />
      </td>

      {renderTextCell("building",          COL_W.building)}
      {renderTextCell("room",              COL_W.room)}
      {renderTextCell("floor",             COL_W.floor)}
      {renderTextCell("volunteers_needed", COL_W.volunteers)}

      <td style={{ ...cell, width: COL_W.timeBlocks, overflow: "visible", minWidth: COL_W.timeBlocks }}>
        <TimeBlocksCell
          event={event}
          timeBlocks={timeBlocks}
          onRemove={(blockId) =>
            onUpdate(event.id, {
              time_block_ids: (event.time_block_ids ?? []).filter((id) => id !== blockId),
            })
          }
          onAdd={(blockId) =>
            onUpdate(event.id, {
              time_block_ids: [...(event.time_block_ids ?? []), blockId],
            })
          }
          isReadOnly={isReadOnly}
        />
      </td>
    </tr>
  );
}

// ─── EventTable ───────────────────────────────────────────────────────────────

export function EventTable({
  events,
  categories,
  timeBlocks,
  onUpdate,
  onCreateCategory,
  onAddClick,
  isReadOnly,
  selectMode,
  selectedIds,
  onToggleSelect,
  onEnterSelectMode,
  onFilteredIdsChange,
}: Props) {
  const [search,     setSearch]     = useState("");
  const [division,   setDivision]   = useState<DivFilter>(null);
  const [eventType,  setEventType]  = useState<TypeFilter>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const headerLabelRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const latestTableScrollRef = useRef<number>(0);
  const headerRafRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return events.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (division   !== null && e.division    !== division)    return false;
      if (eventType  !== null && e.event_type  !== eventType)   return false;
      if (categoryId !== null && e.category_id !== categoryId)  return false;
      return true;
    });
  }, [events, search, division, eventType, categoryId]);

  useEffect(() => {
    onFilteredIdsChange?.(filtered.map((e) => e.id));
  }, [filtered, onFilteredIdsChange]);

  const filterBtn = (active: boolean): CSSProperties => ({
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

  const cols: { label: string; width: number | "auto" }[] = [
    ...(selectMode ? [{ label: "", width: COL_W.select as number | "auto" }] : []),
    { label: "Name",        width: COL_W.name       },
    { label: "Category",    width: COL_W.category   },
    { label: "Division",    width: COL_W.division   },
    { label: "Type",        width: COL_W.type       },
    { label: "Building",    width: COL_W.building   },
    { label: "Room",        width: COL_W.room       },
    { label: "Floor",       width: COL_W.floor      },
    { label: "Volunteers",  width: COL_W.volunteers },
    { label: "Time Blocks", width: COL_W.timeBlocks },
  ];
  const stickyPrefixWidth = selectMode ? COL_W.select + COL_W.name : COL_W.name;
  const headerScrollMeta = useMemo(() => {
    let start = 0;
    return cols
      .map((col, i) => {
        const width = Number(col.width);
        const sticky = selectMode ? i <= 1 : i === 0;
        const meta = { index: i, start, width, sticky };
        start += width;
        return meta;
      })
      .filter((m) => !m.sticky);
  }, [cols, selectMode]);
  const tableMinWidth =
    (selectMode ? COL_W.select : 0) +
    COL_W.name +
    COL_W.category +
    COL_W.division +
    COL_W.type +
    COL_W.building +
    COL_W.room +
    COL_W.floor +
    COL_W.volunteers +
    COL_W.timeBlocks;

  const applyHeaderTransforms = useCallback(() => {
    for (const meta of headerScrollMeta) {
      const label = headerLabelRefs.current.get(meta.index);
      if (!label) continue;
      const labelWidth = label.offsetWidth;
      const maxShift = Math.max(0, meta.width - 20 - labelWidth);
      const desired = latestTableScrollRef.current + stickyPrefixWidth - meta.start;
      const shift = Math.min(Math.max(0, desired), maxShift);
      label.style.transform = `translateX(${Math.round(shift)}px)`;
    }
  }, [headerScrollMeta, stickyPrefixWidth]);

  const onTableScroll = () => {
    const scrollLeft = tableScrollRef.current?.scrollLeft ?? 0;
    latestTableScrollRef.current = scrollLeft;
    if (headerRafRef.current === null) {
      headerRafRef.current = window.requestAnimationFrame(() => {
        headerRafRef.current = null;
        applyHeaderTransforms();
      });
    }
  };

  useEffect(() => {
    latestTableScrollRef.current = tableScrollRef.current?.scrollLeft ?? 0;
    applyHeaderTransforms();
  }, [applyHeaderTransforms]);

  useEffect(() => {
    return () => {
      if (headerRafRef.current !== null) {
        window.cancelAnimationFrame(headerRafRef.current);
      }
    };
  }, []);

  const thStyle: CSSProperties = {
    padding:         "0 10px",
    height:          "36px",
    textAlign:       "left",
    fontFamily:      "var(--font-sans)",
    fontSize:        "11px",
    fontWeight:      600,
    color:           "var(--color-text-secondary)",
    textTransform:   "uppercase",
    letterSpacing:   "0.04em",
    background:      "var(--color-bg)",
    borderBottom:    "1px solid var(--color-border)",
    whiteSpace:      "nowrap",
    userSelect:      "none",
    position:        "sticky",
    top:             0,
    zIndex:          10,
  };

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
            position:      "absolute",
            left:          "9px",
            top:           "50%",
            transform:     "translateY(-50%)",
            color:         "var(--color-text-tertiary)",
            display:       "flex",
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
        {!isReadOnly && !selectMode && (
          <Button size="sm" variant="secondary" onClick={onEnterSelectMode}>
            Select
          </Button>
        )}

        {/* Add event */}
        {!isReadOnly && (
          <Button size="sm" onClick={onAddClick}>
            <IconPlus size={12} />
            Add event
          </Button>
        )}
      </div>

      {/* ── Category chips ── */}
      {categories.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "16px" }}>
          <button style={filterBtn(categoryId === null)} onClick={() => setCategoryId(null)}>
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

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div style={{
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          height:         "200px",
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
              {!isReadOnly && (
                <Button size="sm" onClick={onAddClick}>
                  <IconPlus size={12} />
                  Add first event
                </Button>
              )}
            </>
          ) : (
            <span>No events match your filters.</span>
          )}
        </div>
      ) : (
        <div style={{
          overflowX:    "auto",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
        }}
        ref={tableScrollRef}
        onScroll={onTableScroll}
        >
          <table style={{
            tableLayout:    "fixed",
            width:          tableMinWidth,
            minWidth:       tableMinWidth,
            borderCollapse: "collapse",
          }}>
            <thead>
              <tr>
                {cols.map((col, i) => {
                  const isCheckboxCol = selectMode && i === 0;
                  const isNameCol = selectMode ? i === 1 : i === 0;
                  const stickyLeft = isCheckboxCol ? 0 : isNameCol ? (selectMode ? COL_W.select : 0) : undefined;
                  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds?.has(e.id));
                  const someSelected = !allSelected && filtered.some((e) => selectedIds?.has(e.id));
                  return (
                    <th
                      key={col.label || "cb"}
                      style={{
                        ...thStyle,
                        width: col.width,
                        textAlign: isCheckboxCol ? "center" : "left",
                        ...(isCheckboxCol ? { padding: "0 8px" } : {}),
                        ...(stickyLeft !== undefined
                          ? {
                              left: stickyLeft,
                              zIndex: 12,
                              boxShadow: "inset -1px 0 0 var(--color-border)",
                            }
                          : {}),
                      }}
                    >
                      {isCheckboxCol ? (
                        <div
                          onClick={() => {
                            const ids = filtered.map((e) => e.id);
                            allSelected
                              ? ids.forEach((id) => selectedIds?.has(id) && onToggleSelect?.(id))
                              : ids.filter((id) => !selectedIds?.has(id)).forEach((id) => onToggleSelect?.(id));
                          }}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 18, height: 18, borderRadius: "3px",
                            border: `1.5px solid ${allSelected || someSelected ? "var(--color-accent)" : "var(--color-border)"}`,
                            background: allSelected ? "var(--color-accent)" : "transparent",
                            cursor: "pointer",
                          }}
                        >
                          {allSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {someSelected && !allSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5H8" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                      ) : (
                        <span
                          ref={(el) => {
                            if (el) headerLabelRefs.current.set(i, el);
                            else headerLabelRefs.current.delete(i);
                          }}
                          style={{
                            display: "inline-block",
                            transform: "translateX(0px)",
                            willChange: "transform",
                          }}
                        >
                          {col.label}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => (
                <EventTableRow
                  key={ev.id}
                  event={ev}
                  categories={categories}
                  timeBlocks={timeBlocks}
                  onUpdate={onUpdate}
                  onCreateCategory={onCreateCategory}
                  isReadOnly={isReadOnly}
                  selectMode={selectMode}
                  selected={selectedIds?.has(ev.id)}
                  onToggleSelect={() => onToggleSelect?.(ev.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
