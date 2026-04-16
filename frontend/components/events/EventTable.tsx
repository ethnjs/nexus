"use client";

import { useState, useRef, useEffect, CSSProperties } from "react";
import { Event, EventCreate, TimeBlock, TournamentCategory } from "@/lib/api";
import { catColorVars, fmtTime, fmtDateShort } from "@/lib/formatters";

// ─── Types ────────────────────────────────────────────────────────────────────

type TextCol = "name" | "building" | "room" | "floor";
type NumCol  = "volunteers_needed";

interface Props {
  events:           Event[];
  categories:       TournamentCategory[];
  timeBlocks:       TimeBlock[];
  onUpdate:         (id: number, delta: Partial<EventCreate>) => Promise<void>;
  onCreateCategory: (name: string) => Promise<TournamentCategory>;
  isReadOnly?:      boolean;
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
  background:   "var(--color-surface-raised)",
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
  const [open,     setOpen]     = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [saving,   setSaving]   = useState(false);
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

  const cat    = categories.find((c) => c.id === value);
  const catIdx = cat ? categories.indexOf(cat) : -1;
  const cv     = catIdx >= 0 ? catColorVars(catIdx) : null;

  const handleSelect = async (id: number | null) => {
    setOpen(false);
    await onCommit(id);
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
          maxWidth:     "120px",
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
            background:   "var(--color-surface-raised)",
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
              color:      value === null ? "var(--color-accent)" : "var(--color-text-secondary)",
              background: value === null ? "var(--color-accent-subtle)" : "transparent",
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
            const active = c.id === value;
            return (
              <button
                key={c.id}
                onClick={() => handleSelect(c.id)}
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

  const assigned  = timeBlocks.filter((b) => event.time_block_ids.includes(b.id));
  const available = timeBlocks.filter((b) => !event.time_block_ids.includes(b.id));

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
            background:   "var(--color-surface-raised)",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow:    "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          {available.map((b) => (
            <button
              key={b.id}
              onClick={() => { setPickerOpen(false); onAdd(b.id); }}
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
              }}
            >
              {b.label} · {fmtDateShort(b.date)} {fmtTime(b.start)}–{fmtTime(b.end)}
            </button>
          ))}
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
}: {
  event:            Event;
  categories:       TournamentCategory[];
  timeBlocks:       TimeBlock[];
  onUpdate:         (id: number, delta: Partial<EventCreate>) => Promise<void>;
  onCreateCategory: (name: string) => Promise<TournamentCategory>;
  isReadOnly?:      boolean;
}) {
  const [editing,  setEditing]  = useState<{ col: TextCol | NumCol; draft: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const renderTextCell = (col: TextCol | NumCol, width: number | "auto") => {
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
      style={{
        background:  "transparent",
        transition:  "background var(--transition-fast)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--color-surface)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
    >
      {renderTextCell("name",              200)}

      <td style={{ ...cell, width: 130 }}>
        <CategoryCell
          value={event.category_id}
          categories={categories}
          onCommit={(id) => onUpdate(event.id, { category_id: id })}
          onCreateCategory={onCreateCategory}
          isReadOnly={isReadOnly}
        />
      </td>

      <td style={{ ...cell, width: 90 }}>
        <DivisionCell
          value={event.division}
          onCommit={(div) => onUpdate(event.id, { division: div })}
          isReadOnly={isReadOnly}
        />
      </td>

      <td style={{ ...cell, width: 90 }}>
        <TypeCell
          value={event.event_type}
          onToggle={() => onUpdate(event.id, { event_type: event.event_type === "standard" ? "trial" : "standard" })}
          isReadOnly={isReadOnly}
        />
      </td>

      {renderTextCell("building",          110)}
      {renderTextCell("room",              90)}
      {renderTextCell("floor",             70)}
      {renderTextCell("volunteers_needed", 80)}

      <td style={{ ...cell, width: "auto", overflow: "visible", minWidth: 180 }}>
        <TimeBlocksCell
          event={event}
          timeBlocks={timeBlocks}
          onRemove={(blockId) =>
            onUpdate(event.id, {
              time_block_ids: event.time_block_ids.filter((id) => id !== blockId),
            })
          }
          onAdd={(blockId) =>
            onUpdate(event.id, {
              time_block_ids: [...event.time_block_ids, blockId],
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
  isReadOnly,
}: Props) {
  const cols: { label: string; width: number | "auto" }[] = [
    { label: "Name",        width: 200 },
    { label: "Category",    width: 130 },
    { label: "Division",    width: 90  },
    { label: "Type",        width: 90  },
    { label: "Building",    width: 110 },
    { label: "Room",        width: 90  },
    { label: "Floor",       width: 70  },
    { label: "Volunteers",  width: 80  },
    { label: "Time Blocks", width: "auto" },
  ];

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
    background:      "var(--color-surface)",
    borderBottom:    "1px solid var(--color-border)",
    whiteSpace:      "nowrap",
    userSelect:      "none",
    position:        "sticky",
    top:             0,
    zIndex:          10,
  };

  if (events.length === 0) {
    return (
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          height:         "120px",
          color:          "var(--color-text-tertiary)",
          fontFamily:     "var(--font-sans)",
          fontSize:       "13px",
          border:         "1px dashed var(--color-border)",
          borderRadius:   "var(--radius-md)",
        }}
      >
        No events match your filters.
      </div>
    );
  }

  return (
    <div
      style={{
        overflowX:    "auto",
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <table
        style={{
          tableLayout:    "fixed",
          width:          "100%",
          minWidth:       "1100px",
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col.label} style={{ ...thStyle, width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <EventTableRow
              key={ev.id}
              event={ev}
              categories={categories}
              timeBlocks={timeBlocks}
              onUpdate={onUpdate}
              onCreateCategory={onCreateCategory}
              isReadOnly={isReadOnly}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
