"use client";

import { useState, useEffect, useRef } from "react";
import { TimeBlock, TimeBlockCreate, Event } from "@/lib/api";
import { fmtTime, fmtDate } from "@/lib/formatters";
import { parseApiError } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { IconPlus, IconEdit, IconTrash } from "@/components/ui/Icons";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  timeBlocks:  TimeBlock[];
  events:      Event[];
  isReadOnly?: boolean;
  onAdd:       (data: TimeBlockCreate) => Promise<void>;
  onEdit:      (id: number, data: Partial<TimeBlockCreate>) => Promise<void>;
  onDelete:    (block: TimeBlock) => void;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  fontFamily:    "var(--font-sans)",
  fontSize:      "11px",
  fontWeight:    600,
  color:         "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding:       "9px 14px",
  textAlign:     "left",
  borderBottom:  "1px solid var(--color-border)",
  whiteSpace:    "nowrap",
  background:    "var(--color-surface)",
};

const tdStyle: React.CSSProperties = {
  fontFamily:    "var(--font-mono)",
  fontSize:      "13px",
  color:         "var(--color-text-primary)",
  padding:       "10px 14px",
  borderBottom:  "1px solid var(--color-border)",
  verticalAlign: "middle",
};

const inputStyle: React.CSSProperties = {
  fontFamily:   "var(--font-mono)",
  fontSize:     "13px",
  color:        "var(--color-text-primary)",
  background:   "var(--color-surface)",
  border:       "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  padding:      "4px 8px",
  outline:      "none",
  width:        "100%",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_FORM: TimeBlockCreate = { label: "", date: "", start: "", end: "" };

// ─── Day separator row ────────────────────────────────────────────────────────

function DaySeparator({ date, colSpan }: { date: string; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          fontFamily:    "var(--font-sans)",
          fontSize:      "11px",
          fontWeight:    600,
          color:         "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          padding:       "8px 14px 6px",
          background:    "var(--color-bg)",
          borderBottom:  "1px solid var(--color-border)",
          borderTop:     "1px solid var(--color-border)",
        }}
      >
        {fmtDate(date)}
      </td>
    </tr>
  );
}

// ─── Inline form row ──────────────────────────────────────────────────────────

function InlineRow({
  initial,
  colSpan,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial:  TimeBlockCreate;
  colSpan:  number;
  saving:   boolean;
  error:    string | null;
  onSave:   (data: TimeBlockCreate) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TimeBlockCreate>(initial);
  const labelRef = useRef<HTMLInputElement>(null);

  // Focus label on mount
  useEffect(() => { labelRef.current?.focus(); }, []);

  const set = (field: keyof TimeBlockCreate, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const valid = form.label.trim() && form.date && form.start && form.end;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && valid) onSave(form);
  };

  return (
    <>
      <tr onKeyDown={handleKey}>
        {/* Label */}
        <td style={{ ...tdStyle, borderBottom: "1px solid var(--color-border)" }}>
          <input
            ref={labelRef}
            type="text"
            placeholder="Label"
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            style={{ ...inputStyle, minWidth: "120px" }}
          />
        </td>

        {/* Date */}
        <td style={{ ...tdStyle, borderBottom: "1px solid var(--color-border)" }}>
          <input
            type="date"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
            style={{ ...inputStyle, minWidth: "140px" }}
          />
        </td>

        {/* Time range — start + end side by side */}
        <td style={{ ...tdStyle, borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input
              type="time"
              value={form.start}
              onChange={(e) => set("start", e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>–</span>
            <input
              type="time"
              value={form.end}
              onChange={(e) => set("end", e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
          </div>
        </td>

        {/* Events count — empty for new/edit row */}
        <td style={{ ...tdStyle, borderBottom: "1px solid var(--color-border)", textAlign: "center" }}>
          <span style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>—</span>
        </td>

        {/* Actions */}
        {colSpan === 5 && (
          <td style={{ ...tdStyle, borderBottom: "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
            <Button
              size="sm"
              onClick={() => valid && onSave(form)}
              loading={saving}
              disabled={!valid}
              style={{ marginRight: "4px" }}
            >
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </td>
        )}
      </tr>

      {/* Validation / API error */}
      {error && (
        <tr style={{ background: "var(--color-danger-subtle)" }}>
          <td
            colSpan={colSpan}
            style={{
              fontFamily:  "var(--font-sans)",
              fontSize:    "12px",
              color:       "var(--color-danger)",
              padding:     "6px 14px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimeBlocksTable({
  timeBlocks,
  events,
  isReadOnly = false,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);

  // Number of table columns (5 in manage mode, 4 in read-only)
  const colSpan = isReadOnly ? 4 : 5;

  const handleAddClick = () => {
    setEditingId(null);
    setSaveError(null);
    setShowAddRow(true);
  };

  const handleEditClick = (block: TimeBlock) => {
    setShowAddRow(false);
    setSaveError(null);
    setEditingId(block.id);
  };

  const handleCancel = () => {
    setEditingId(null);
    setShowAddRow(false);
    setSaveError(null);
  };

  const handleSaveNew = async (data: TimeBlockCreate) => {
    setSaving(true);
    setSaveError(null);
    try {
      await onAdd(data);
      setShowAddRow(false);
    } catch (e) {
      setSaveError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (id: number, data: TimeBlockCreate) => {
    setSaving(true);
    setSaveError(null);
    try {
      await onEdit(id, data);
      setEditingId(null);
    } catch (e) {
      setSaveError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Count how many events are assigned to each block
  const eventCount = (blockId: number) =>
    events.filter((e) => e.time_block_ids?.includes(blockId)).length;

  // Group blocks by date (pre-sorted by API: date then start)
  const rows: Array<
    | { type: "separator"; date: string }
    | { type: "block"; block: TimeBlock }
  > = [];
  let lastDate = "";
  for (const block of timeBlocks) {
    if (block.date !== lastDate) {
      rows.push({ type: "separator", date: block.date });
      lastDate = block.date;
    }
    rows.push({ type: "block", block });
  }

  // Decide whether to show the table wrapper (show it even when empty if
  // the add row is open, so the inline row has a home)
  const showTable = timeBlocks.length > 0 || showAddRow;

  return (
    <div>
      {/* ── Toolbar ── */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          marginBottom:   "14px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize:   "13px",
            color:      "var(--color-text-secondary)",
          }}
        >
          {timeBlocks.length} block{timeBlocks.length !== 1 ? "s" : ""}
        </span>

        {!isReadOnly && (
          <Button
            size="sm"
            onClick={handleAddClick}
            disabled={showAddRow || editingId !== null}
          >
            <IconPlus size={12} />
            Add block
          </Button>
        )}
      </div>

      {/* ── Empty state (no blocks, no add row open) ── */}
      {!showTable && (
        <div
          style={{
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "center",
            padding:        "60px 0",
            border:         "1px dashed var(--color-border)",
            borderRadius:   "var(--radius-lg)",
            background:     "var(--color-surface)",
            textAlign:      "center",
            gap:            "6px",
          }}
        >
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "18px", color: "var(--color-text-primary)" }}>
            No time blocks yet
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {isReadOnly
              ? "No blocks have been scheduled for this tournament."
              : "Add a block to start scheduling events."}
          </p>
        </div>
      )}

      {/* ── Table ── */}
      {showTable && (
        <div
          style={{
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            overflowX:    "auto",
            background:   "var(--color-surface)",
          }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: "20%" }}>Label</th>
                <th style={{ ...thStyle, width: "16%" }}>Day</th>
                <th style={{ ...thStyle, width: "20%" }}>Time range</th>
                <th style={{ ...thStyle, width: "26%", textAlign: "center" }}>Events</th>
                {!isReadOnly && (
                  <th style={{ ...thStyle, width: "18%", textAlign: "right" }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                if (row.type === "separator") {
                  return (
                    <DaySeparator
                      key={`sep-${row.date}`}
                      date={row.date}
                      colSpan={colSpan}
                    />
                  );
                }

                const { block } = row;
                const count   = eventCount(block.id);
                const isLast  = i === rows.length - 1 && !showAddRow;
                const editing = editingId === block.id;

                if (editing) {
                  return (
                    <InlineRow
                      key={block.id}
                      initial={{ label: block.label, date: block.date, start: block.start, end: block.end }}
                      colSpan={colSpan}
                      saving={saving}
                      error={saveError}
                      onSave={(data) => handleSaveEdit(block.id, data)}
                      onCancel={handleCancel}
                    />
                  );
                }

                return (
                  <tr
                    key={block.id}
                    style={{ transition: "background var(--transition-fast)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "var(--color-bg)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "transparent";
                    }}
                  >
                    {/* Label */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", fontWeight: 500 }}>
                      {block.label}
                    </td>

                    {/* Day */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                      {fmtDate(block.date)}
                    </td>

                    {/* Time range */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)" }}>
                      {fmtTime(block.start)}
                      <span style={{ color: "var(--color-text-tertiary)", margin: "0 5px" }}>–</span>
                      {fmtTime(block.end)}
                    </td>

                    {/* Events count */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", textAlign: "center" }}>
                      {count > 0 ? (
                        <span
                          style={{
                            display:        "inline-flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            minWidth:       "22px",
                            height:         "22px",
                            padding:        "0 6px",
                            borderRadius:   "var(--radius-sm)",
                            background:     "var(--color-accent-subtle)",
                            fontFamily:     "var(--font-sans)",
                            fontSize:       "11px",
                            fontWeight:     600,
                            color:          "var(--color-text-primary)",
                          }}
                        >
                          {count}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>—</span>
                      )}
                    </td>

                    {/* Actions */}
                    {!isReadOnly && (
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(block)}
                          title="Edit block"
                          style={{ padding: "0 8px" }}
                          disabled={showAddRow || editingId !== null}
                        >
                          <IconEdit size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(block)}
                          title="Delete block"
                          style={{ padding: "0 8px", color: "var(--color-danger)" }}
                          disabled={showAddRow || editingId !== null}
                        >
                          <IconTrash size={14} />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* ── Add row at bottom ── */}
              {showAddRow && (
                <InlineRow
                  initial={EMPTY_FORM}
                  colSpan={colSpan}
                  saving={saving}
                  error={saveError}
                  onSave={handleSaveNew}
                  onCancel={handleCancel}
                />
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
