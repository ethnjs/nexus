"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tournamentShiftsApi, tournamentEventsApi, ApiError, TournamentShift, TournamentEvent } from "@/lib/api";
import {
  toDateInput, toTimeInput, fromDayAndTime, formatTimeOfDay, formatDayLabel,
} from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { TournamentDayPicker } from "@/components/tournament/TournamentDayPicker";
import { DeleteShiftModal } from "@/components/tournament/events/DeleteShiftModal";
import { ShiftEventsCard } from "@/components/tournament/events/ShiftEventsCard";
import { IconPlus, IconTrash, IconCalendar, IconEdit, IconX } from "@/components/ui/Icons";

const SHIFT_ROW_COLUMNS = "1.6fr 1.1fr 0.8fr 0.8fr 90px";

interface ShiftDraftRow {
  id: number; // negative = unsaved new row, matches the roles editor's temp-id convention
  label: string;
  // Split day + time-of-day — shifts don't cross midnight, so there's one
  // day to pick, usually locked to the tournament's own single day.
  day: string;
  startTime: string;
  endTime: string;
}

function toDraftRow(s: TournamentShift): ShiftDraftRow {
  return { id: s.id, label: s.label, day: toDateInput(s.start), startTime: toTimeInput(s.start), endTime: toTimeInput(s.end) };
}

function isTempId(id: number): boolean {
  return id < 0;
}

function rowDiffers(row: ShiftDraftRow, saved: TournamentShift): boolean {
  const savedRow = toDraftRow(saved);
  return row.label !== savedRow.label || row.day !== savedRow.day || row.startTime !== savedRow.startTime || row.endTime !== savedRow.endTime;
}

interface RowFieldErrors {
  label?: string;
  day?: string;
  startTime?: string;
  endTime?: string;
}

function validateRow(row: ShiftDraftRow): RowFieldErrors | null {
  const errors: RowFieldErrors = {};
  if (!row.label.trim()) errors.label = "Required";
  if (!row.day) errors.day = "Required";
  if (!row.startTime) errors.startTime = "Required";
  if (!row.endTime) errors.endTime = "Required";
  return Object.keys(errors).length > 0 ? errors : null;
}

interface ShiftsTabProps {
  tournamentId: number;
  canManageEvents: boolean;
}

export function ShiftsTab({ tournamentId, canManageEvents }: ShiftsTabProps) {
  const { isArchived, days, isMultiDay } = useTournament();
  const [shifts, setShifts] = useState<TournamentShift[] | null>(null);
  const [draft, setDraft] = useState<ShiftDraftRow[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<number, RowFieldErrors>>({});
  const [deleteTarget, setDeleteTarget] = useState<TournamentShift | null>(null);

  // Any number of rows can show editable inputs at once — clicking Edit on
  // one row doesn't close another. No separate per-row confirm step;
  // committing to the backend happens only via the FloatingSaveBar below.
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());

  // This tournament's events, fetched once so the attached-events card can
  // filter locally instead of a round-trip per shift click. Only one
  // shift's card is open at a time (split-view: table shrinks left).
  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [expandedShiftId, setExpandedShiftId] = useState<number | null>(null);

  // Drives the panel's open/close animation. panelMountedId lags behind
  // expandedShiftId on close (stays mounted through the collapse
  // transition instead of vanishing instantly); panelExpanded is flipped
  // a frame after mount so there's an actual 0 -> full-width transition
  // to animate rather than appearing already-open.
  const [panelMountedId, setPanelMountedId] = useState<number | null>(null);
  const [panelExpanded, setPanelExpanded] = useState(false);
  useEffect(() => {
    if (expandedShiftId !== null) {
      setPanelMountedId(expandedShiftId);
      // A single rAF often fires before the browser has actually painted
      // the just-mounted width:0 state, so the width:440 flip lands in the
      // same paint and there's nothing to visibly transition from. Nesting
      // a second rAF guarantees one real paint happens in between.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPanelExpanded(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setPanelExpanded(false);
  }, [expandedShiftId]);

  const nextTempIdRef = useRef(-1);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId)
      .then((next) => { setShifts(next); setDraft(next.map(toDraftRow)); })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load shifts."));
    tournamentEventsApi.list(tournamentId).then(setEvents).catch(() => setEvents([]));
  }, [tournamentId]);

  const pendingEdits = useMemo(
    () => draft.filter((row) => !isTempId(row.id) && rowDiffers(row, shifts!.find((s) => s.id === row.id)!)),
    [draft, shifts]
  );
  const newRows = useMemo(() => draft.filter((row) => isTempId(row.id)), [draft]);
  // Having any row open in edit mode counts as dirty even with no actual
  // field changes yet — otherwise there'd be no way back to view mode
  // short of a refresh, since the save bar (the only Cancel control) would
  // stay hidden.
  const isDirty = pendingEdits.length > 0 || newRows.length > 0 || editingIds.size > 0;

  function patchRow(id: number, patch: Partial<ShiftDraftRow>) {
    setDraft((cur) => cur.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    // Clear just the fields being edited — leaves errors on fields the user
    // hasn't touched yet instead of wiping the whole row's error state.
    setFieldErrors((cur) => {
      const rowErrors = cur[id];
      if (!rowErrors) return cur;
      const next = { ...rowErrors };
      for (const key of Object.keys(patch) as (keyof RowFieldErrors)[]) delete next[key];
      if (Object.keys(next).length === Object.keys(rowErrors).length) return cur;
      const { [id]: _omit, ...rest } = cur;
      return Object.keys(next).length > 0 ? { ...rest, [id]: next } : rest;
    });
  }

  function addRow() {
    const id = nextTempIdRef.current--;
    // A single-day tournament has only one valid day anyway — default to
    // it immediately instead of making every new shift pick it.
    const day = !isMultiDay && days[0] ? days[0] : "";
    setDraft((cur) => [...cur, { id, label: "", day, startTime: "", endTime: "" }]);
    setEditingIds((cur) => new Set(cur).add(id));
    setSaveError(undefined);
  }

  // The X a row's Edit button turns into — closes edit mode for just that
  // row, discarding whatever was typed (an unsaved new row is dropped
  // entirely; an existing row reverts to its last-saved values).
  function cancelRowEdit(id: number) {
    if (isTempId(id)) {
      setDraft((cur) => cur.filter((row) => row.id !== id));
    } else {
      const saved = shifts!.find((s) => s.id === id)!;
      setDraft((cur) => cur.map((row) => (row.id === id ? toDraftRow(saved) : row)));
    }
    setEditingIds((cur) => {
      if (!cur.has(id)) return cur;
      const next = new Set(cur);
      next.delete(id);
      return next;
    });
    setFieldErrors((cur) => {
      if (!cur[id]) return cur;
      const { [id]: _omit, ...rest } = cur;
      return rest;
    });
  }

  function deleteRow(id: number) {
    if (isTempId(id)) {
      setDraft((cur) => cur.filter((row) => row.id !== id));
      setEditingIds((cur) => {
        if (!cur.has(id)) return cur;
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      setFieldErrors((cur) => {
        if (!cur[id]) return cur;
        const { [id]: _omit, ...rest } = cur;
        return rest;
      });
      return;
    }
    const saved = shifts!.find((s) => s.id === id);
    if (saved) setDeleteTarget(saved);
  }

  // Mirrors the event panel's own shift attach/detach — updates the local
  // events list in place instead of refetching, and keeps each shift's
  // event_count (used by the delete-confirm warning) in sync alongside it.
  function handleShiftAttached(shift: TournamentShift, event: TournamentEvent) {
    setEvents((cur) => (cur ?? []).map((e) => (e.id === event.id ? { ...e, shifts: [...e.shifts, shift] } : e)));
    setShifts((cur) => (cur ?? []).map((s) => (s.id === shift.id ? { ...s, event_count: s.event_count + 1 } : s)));
  }

  function handleShiftDetached(shift: TournamentShift, event: TournamentEvent) {
    setEvents((cur) => (cur ?? []).map((e) => (e.id === event.id ? { ...e, shifts: e.shifts.filter((s) => s.id !== shift.id) } : e)));
    setShifts((cur) => (cur ?? []).map((s) => (s.id === shift.id ? { ...s, event_count: Math.max(0, s.event_count - 1) } : s)));
  }

  async function handleSaveAll() {
    if (!shifts) return;

    const errors: Record<number, RowFieldErrors> = {};
    for (const row of [...pendingEdits, ...newRows]) {
      const rowErrors = validateRow(row);
      if (rowErrors) errors[row.id] = rowErrors;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // Force every invalid row into edit mode so its errors are visible —
      // one could be mid-edit-but-collapsed if it was left incomplete earlier.
      setEditingIds((cur) => new Set([...cur, ...Object.keys(errors).map(Number)]));
      return;
    }

    setFieldErrors({});
    setSaving(true);
    setSaveError(undefined);
    try {
      // allSettled (not all) so a 409 on one row doesn't hide which row it
      // came from — each entry stays paired with its row for attribution.
      const entries = [
        ...newRows.map((row) => ({
          row,
          promise: tournamentShiftsApi.create(tournamentId, {
            label: row.label.trim(), start: fromDayAndTime(row.day, row.startTime)!, end: fromDayAndTime(row.day, row.endTime)!,
          }),
        })),
        ...pendingEdits.map((row) => ({
          row,
          promise: tournamentShiftsApi.update(tournamentId, row.id, {
            label: row.label.trim(), start: fromDayAndTime(row.day, row.startTime)!, end: fromDayAndTime(row.day, row.endTime)!,
          }),
        })),
      ];
      const results = await Promise.allSettled(entries.map((e) => e.promise));

      const savedById = new Map<number, TournamentShift>();
      const rowErrors: Record<number, RowFieldErrors> = {};
      let generic: string | undefined;
      results.forEach((result, i) => {
        const { row } = entries[i];
        if (result.status === "fulfilled") {
          savedById.set(row.id, result.value);
          return;
        }
        const err = result.reason;
        // The bounds check comes back as a 409 naming which end it's about
        // ("Shift start falls before ..." / "Shift end falls after ...") —
        // route it to that row's Input instead of just the floating bar.
        if (err instanceof ApiError && err.status === 409 && err.message.includes("Shift start")) {
          rowErrors[row.id] = { ...rowErrors[row.id], startTime: err.message };
        } else if (err instanceof ApiError && err.status === 409 && err.message.includes("Shift end")) {
          rowErrors[row.id] = { ...rowErrors[row.id], endTime: err.message };
        } else {
          generic = err instanceof ApiError ? err.message : "Failed to save shifts.";
        }
      });

      // Rows that saved settle into their real state (a temp new row swaps
      // its negative id for the real one) and drop out of edit mode. Rows
      // that failed keep whatever the user typed, still in edit mode with
      // their error — this matters beyond convenience: if a saved temp row
      // were left as-is, retrying the batch would resubmit it as a second
      // create and duplicate it on the backend.
      if (savedById.size > 0) {
        setShifts((cur) => {
          const byId = new Map((cur ?? []).map((s) => [s.id, s] as const));
          for (const saved of savedById.values()) byId.set(saved.id, saved);
          return Array.from(byId.values()).sort((a, b) => a.start.localeCompare(b.start));
        });
        setDraft((cur) => cur.map((row) => {
          const saved = savedById.get(row.id);
          return saved ? toDraftRow(saved) : row;
        }));
        setEditingIds((cur) => {
          const next = new Set(cur);
          for (const id of savedById.keys()) next.delete(id);
          return next;
        });
      }

      setFieldErrors(rowErrors);
      if (Object.keys(rowErrors).length > 0) {
        setEditingIds((cur) => new Set([...cur, ...Object.keys(rowErrors).map(Number)]));
      } else if (!generic) {
        // Nothing failed — also close rows that were open in edit mode with
        // no actual changes (never part of pendingEdits/newRows, so the
        // savedById cleanup above never saw them).
        setEditingIds(new Set());
      }
      setSaveError(generic);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save shifts.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelAll() {
    if (!shifts) return;
    setDraft(shifts.map(toDraftRow));
    setEditingIds(new Set());
    setFieldErrors({});
    setSaveError(undefined);
  }

  if (shifts === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const canEdit = canManageEvents && !isArchived;
  const isEmpty = draft.length === 0;

  return (
    <div>
      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEmpty ? (
            <Card radius="lg" style={{ padding: "8px" }}>
              <EmptyState
                icon={<IconCalendar size={28} />}
                title="No shifts yet"
                description="Shifts are time windows you can attach to events, like &ldquo;Morning — 8am to noon&rdquo;."
                action={canEdit ? (
                  <Button type="button" variant="primary" size="sm" onClick={addRow}>
                    <IconPlus size={12} /> Add shift
                  </Button>
                ) : undefined}
              />
            </Card>
          ) : (
            <>
              {canEdit && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                  <Button type="button" variant="primary" size="md" onClick={addRow}>
                    <IconPlus size={14} /> Add shift
                  </Button>
                </div>
              )}

              <Card radius="lg" style={{ padding: "8px 12px" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: SHIFT_ROW_COLUMNS, gap: "10px",
                  padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
                  fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: "var(--color-text-tertiary)",
                }}>
                  <span>Shifts — {shifts.length}</span>
                  <span>Day</span>
                  <span>Start</span>
                  <span>End</span>
                  <span style={{ textAlign: "center" }}>Actions</span>
                </div>

                {draft.map((row, i) => (
                  <ShiftRow
                    key={row.id}
                    row={row}
                    isLast={i === draft.length - 1}
                    editing={canEdit && editingIds.has(row.id)}
                    canEdit={canEdit}
                    expanded={expandedShiftId === row.id}
                    errors={fieldErrors[row.id]}
                    days={days}
                    onChange={(patch) => patchRow(row.id, patch)}
                    onEdit={() => setEditingIds((cur) => new Set(cur).add(row.id))}
                    onCancelEdit={() => cancelRowEdit(row.id)}
                    onDelete={() => deleteRow(row.id)}
                    onToggleExpand={() => {
                      if (isTempId(row.id)) return;
                      setExpandedShiftId((cur) => (cur === row.id ? null : row.id));
                    }}
                  />
                ))}
              </Card>
            </>
          )}
        </div>

        {panelMountedId !== null && events !== null && (() => {
          const shift = shifts.find((s) => s.id === panelMountedId);
          if (!shift) return null;
          const panelWidth = 440;
          return (
            <div
              onTransitionEnd={() => { if (!panelExpanded) setPanelMountedId(null); }}
              style={{
                width: panelExpanded ? panelWidth : 0,
                opacity: panelExpanded ? 1 : 0,
                flexShrink: 0, overflow: "hidden",
                transition: "width 420ms ease, opacity 380ms ease",
              }}
            >
              <div style={{ width: panelWidth }}>
                <ShiftEventsCard
                  tournamentId={tournamentId}
                  shift={shift}
                  events={events}
                  locked={!canEdit}
                  onClose={() => setExpandedShiftId(null)}
                  onAttached={(event) => handleShiftAttached(shift, event)}
                  onDetached={(event) => handleShiftDetached(shift, event)}
                />
              </div>
            </div>
          );
        })()}
      </div>

      {canEdit && (
        <FloatingSaveBar
          visible={isDirty}
          saving={saving}
          error={saveError}
          onSave={handleSaveAll}
          onCancel={handleCancelAll}
        />
      )}

      {deleteTarget && (
        <DeleteShiftModal
          tournamentId={tournamentId}
          shift={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setShifts((cur) => (cur ?? []).filter((s) => s.id !== deleteTarget.id));
            setDraft((cur) => cur.filter((row) => row.id !== deleteTarget.id));
            setFieldErrors((cur) => {
              if (!cur[deleteTarget.id]) return cur;
              const { [deleteTarget.id]: _omit, ...rest } = cur;
              return rest;
            });
            setExpandedShiftId((cur) => (cur === deleteTarget.id ? null : cur));
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ShiftRow({ row, isLast, editing, canEdit, expanded, errors, days, onChange, onEdit, onCancelEdit, onDelete, onToggleExpand }: {
  row: ShiftDraftRow;
  isLast: boolean;
  editing: boolean;
  canEdit: boolean;
  expanded: boolean;
  errors?: RowFieldErrors;
  days: string[];
  onChange: (patch: Partial<ShiftDraftRow>) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isTemp = isTempId(row.id);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={editing || isTemp ? undefined : onToggleExpand}
      style={{
        display: "grid", gridTemplateColumns: SHIFT_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: editing ? "8px 12px" : "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: expanded ? "var(--color-accent-subtle)" : hovered ? "var(--color-bg)" : "transparent",
        cursor: editing || isTemp ? undefined : "pointer",
        transition: "background 100ms ease",
      }}
    >
      {editing ? (
        <>
          <Input
            value={row.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Label"
            font="sans" size="sm" fullWidth
            error={errors?.label}
          />
          <TournamentDayPicker
            value={row.day}
            onChange={(v) => onChange({ day: v })}
            days={days}
            placeholder="Day"
            size="sm"
            fullWidth
          />
          <Input
            type="time"
            value={row.startTime}
            onChange={(e) => onChange({ startTime: e.target.value })}
            size="sm" fullWidth
            error={errors?.startTime}
          />
          <Input
            type="time"
            value={row.endTime}
            onChange={(e) => onChange({ endTime: e.target.value })}
            size="sm" fullWidth
            error={errors?.endTime}
          />
        </>
      ) : (
        <>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>{row.label || "—"}</span>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {row.day ? formatDayLabel(row.day) : "—"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {row.startTime ? formatTimeOfDay(row.startTime) : "—"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {row.endTime ? formatTimeOfDay(row.endTime) : "—"}
          </span>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
        {canEdit && (
          <>
            {editing ? (
              <Button type="button" variant="secondary" size="sm" iconOnly title="Stop editing" onClick={onCancelEdit}>
                <IconX size={13} />
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" iconOnly title="Edit shift" onClick={onEdit}>
                <IconEdit size={13} />
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" iconOnly title="Delete shift" onClick={onDelete}>
              <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
