"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tournamentShiftsApi, ApiError, TournamentShift } from "@/lib/api";
import { toDatetimeLocal, fromDatetimeLocal, formatDateTime } from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { DeleteShiftModal } from "@/components/tournament/events/DeleteShiftModal";
import { IconPlus, IconTrash, IconCalendar, IconEdit } from "@/components/ui/Icons";

const SHIFT_ROW_COLUMNS = "2fr 1fr 1fr 90px";

interface ShiftDraftRow {
  id: number; // negative = unsaved new row, matches the roles editor's temp-id convention
  label: string;
  start: string; // datetime-local value
  end: string;
}

function toDraftRow(s: TournamentShift): ShiftDraftRow {
  return { id: s.id, label: s.label, start: toDatetimeLocal(s.start), end: toDatetimeLocal(s.end) };
}

function isTempId(id: number): boolean {
  return id < 0;
}

function rowDiffers(row: ShiftDraftRow, saved: TournamentShift): boolean {
  return row.label !== saved.label || row.start !== toDatetimeLocal(saved.start) || row.end !== toDatetimeLocal(saved.end);
}

interface RowFieldErrors {
  label?: string;
  start?: string;
  end?: string;
}

function validateRow(row: ShiftDraftRow): RowFieldErrors | null {
  const errors: RowFieldErrors = {};
  if (!row.label.trim()) errors.label = "Required";
  if (!row.start) errors.start = "Required";
  if (!row.end) errors.end = "Required";
  return Object.keys(errors).length > 0 ? errors : null;
}

interface ShiftsTabProps {
  tournamentId: number;
  canManageEvents: boolean;
}

export function ShiftsTab({ tournamentId, canManageEvents }: ShiftsTabProps) {
  const { isArchived } = useTournament();
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

  const nextTempIdRef = useRef(-1);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId)
      .then((next) => { setShifts(next); setDraft(next.map(toDraftRow)); })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load shifts."));
  }, [tournamentId]);

  const pendingEdits = useMemo(
    () => draft.filter((row) => !isTempId(row.id) && rowDiffers(row, shifts!.find((s) => s.id === row.id)!)),
    [draft, shifts]
  );
  const newRows = useMemo(() => draft.filter((row) => isTempId(row.id)), [draft]);
  const isDirty = pendingEdits.length > 0 || newRows.length > 0;

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
    setDraft((cur) => [...cur, { id, label: "", start: "", end: "" }]);
    setEditingIds((cur) => new Set(cur).add(id));
    setSaveError(undefined);
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
      await Promise.all([
        ...newRows.map((row) =>
          tournamentShiftsApi.create(tournamentId, {
            label: row.label.trim(), start: fromDatetimeLocal(row.start)!, end: fromDatetimeLocal(row.end)!,
          })
        ),
        ...pendingEdits.map((row) =>
          tournamentShiftsApi.update(tournamentId, row.id, {
            label: row.label.trim(), start: fromDatetimeLocal(row.start)!, end: fromDatetimeLocal(row.end)!,
          })
        ),
      ]);
      const fresh = await tournamentShiftsApi.list(tournamentId);
      setShifts(fresh);
      setDraft(fresh.map(toDraftRow));
      setEditingIds(new Set());
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
                errors={fieldErrors[row.id]}
                onChange={(patch) => patchRow(row.id, patch)}
                onEdit={() => setEditingIds((cur) => new Set(cur).add(row.id))}
                onDelete={() => deleteRow(row.id)}
              />
            ))}
          </Card>
        </>
      )}

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
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ShiftRow({ row, isLast, editing, canEdit, errors, onChange, onEdit, onDelete }: {
  row: ShiftDraftRow;
  isLast: boolean;
  editing: boolean;
  canEdit: boolean;
  errors?: RowFieldErrors;
  onChange: (patch: Partial<ShiftDraftRow>) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: SHIFT_ROW_COLUMNS, alignItems: "center",
      gap: "10px", padding: editing ? "8px 12px" : "10px 12px",
      borderBottom: isLast ? "none" : "1px solid var(--color-border)",
    }}>
      {editing ? (
        <>
          <Input
            value={row.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Label"
            font="sans" size="sm" fullWidth
            error={errors?.label}
          />
          <Input
            type="datetime-local"
            value={row.start}
            onChange={(e) => onChange({ start: e.target.value })}
            size="sm" fullWidth
            error={errors?.start}
          />
          <Input
            type="datetime-local"
            value={row.end}
            onChange={(e) => onChange({ end: e.target.value })}
            size="sm" fullWidth
            error={errors?.end}
          />
        </>
      ) : (
        <>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>{row.label || "—"}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {row.start ? formatDateTime(fromDatetimeLocal(row.start)!) : "—"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {row.end ? formatDateTime(fromDatetimeLocal(row.end)!) : "—"}
          </span>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }}>
        {canEdit && (
          <>
            {!editing && (
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
