"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tournamentShiftsApi, ApiError, TournamentShift } from "@/lib/api";
import { toDatetimeLocal, fromDatetimeLocal } from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { DeleteShiftModal } from "@/components/tournament/events/DeleteShiftModal";
import { IconPlus, IconTrash, IconCalendar } from "@/components/ui/Icons";

const SHIFT_ROW_COLUMNS = "2fr 1fr 1fr 60px";

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

function isRowComplete(row: ShiftDraftRow): boolean {
  return !!row.label.trim() && !!row.start && !!row.end;
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
  const [deleteTarget, setDeleteTarget] = useState<TournamentShift | null>(null);

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
  }

  function addRow() {
    const id = nextTempIdRef.current--;
    setDraft((cur) => [...cur, { id, label: "", start: "", end: "" }]);
  }

  function discardTempRow(id: number) {
    setDraft((cur) => cur.filter((row) => row.id !== id));
  }

  async function handleSave() {
    if (!shifts) return;
    const incomplete = [...pendingEdits, ...newRows].some((row) => !isRowComplete(row));
    if (incomplete) {
      setSaveError("Every shift needs a label, start, and end.");
      return;
    }

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
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save shifts.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (!shifts) return;
    setDraft(shifts.map(toDraftRow));
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

  return (
    <div>
      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {draft.length === 0 ? (
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
                locked={!canEdit}
                onChange={(patch) => patchRow(row.id, patch)}
                onDelete={() => {
                  if (isTempId(row.id)) { discardTempRow(row.id); return; }
                  const saved = shifts.find((s) => s.id === row.id);
                  if (saved) setDeleteTarget(saved);
                }}
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
          onSave={handleSave}
          onCancel={handleCancel}
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
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ShiftRow({ row, isLast, locked, onChange, onDelete }: {
  row: ShiftDraftRow;
  isLast: boolean;
  locked: boolean;
  onChange: (patch: Partial<ShiftDraftRow>) => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: SHIFT_ROW_COLUMNS, alignItems: "center",
      gap: "10px", padding: "8px 12px",
      borderBottom: isLast ? "none" : "1px solid var(--color-border)",
    }}>
      <Input
        value={row.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Label"
        font="sans" size="sm" locked={locked} fullWidth
      />
      <Input
        type="datetime-local"
        value={row.start}
        onChange={(e) => onChange({ start: e.target.value })}
        size="sm" locked={locked} fullWidth
      />
      <Input
        type="datetime-local"
        value={row.end}
        onChange={(e) => onChange({ end: e.target.value })}
        size="sm" locked={locked} fullWidth
      />
      <div style={{ display: "flex", justifyContent: "center" }}>
        {!locked && (
          <Button type="button" variant="secondary" size="sm" iconOnly title="Delete shift" onClick={onDelete}>
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        )}
      </div>
    </div>
  );
}
