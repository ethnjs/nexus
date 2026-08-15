"use client";

import { useState } from "react";
import { tournamentShiftsApi, TournamentShift, ApiError } from "@/lib/api";
import { fromDayAndTime } from "@/lib/timeFormat";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface CreateShiftFormProps {
  tournamentId: number;
  /** The day (YYYY-MM-DD) the new shift is created on — shifts don't cross midnight, so this is fixed rather than picked per shift. */
  day: string;
  /** Called once the shift exists on the backend; the caller owns attaching it (to one event, or several in a mass-edit context) and closing the popover once that succeeds. May throw/reject — the form shows the error inline and stays open. */
  onCreated: (shift: TournamentShift) => void | Promise<void>;
  onCancel: () => void;
}

export function CreateShiftForm({ tournamentId, day, onCreated, onCancel }: CreateShiftFormProps) {
  const [label, setLabel] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!label.trim() || !startTime || !endTime) {
      setError("Label, start, and end are all required.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const shift = await tournamentShiftsApi.create(tournamentId, {
        label: label.trim(),
        start: fromDayAndTime(day, startTime)!,
        end: fromDayAndTime(day, endTime)!,
      });
      await onCreated(shift);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create shift.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <Input
        label="Label" font="sans" size="sm" fullWidth
        value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Morning"
      />
      <div style={{ display: "flex", gap: "8px" }}>
        <Input label="Start" type="time" size="sm" fullWidth value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <Input label="End" type="time" size="sm" fullWidth value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </div>
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>{error}</p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "2px" }}>
        <Button type="button" variant="secondary" size="xs" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" size="xs" onClick={handleSubmit} disabled={saving}>
          {saving ? "Creating…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
