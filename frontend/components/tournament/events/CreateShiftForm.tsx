"use client";

import { useMemo, useState } from "react";
import { tournamentShiftsApi, TournamentShift, TournamentTrack, ApiError } from "@/lib/api";
import { fromDayAndTime } from "@/lib/timeFormat";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";
import { TrackDayPicker, trackDays } from "@/components/tournament/TrackDayPicker";

interface CreateShiftFormProps {
  tournamentId: number;
  /**
   * The competition days this shift may be created on — for the event panel,
   * the tracks the event itself is on. A shift needs a track: it is what
   * gives it a date range to validate against, and what an availability
   * question groups it under.
   */
  tracks: TournamentTrack[];
  /** Called once the shift exists on the backend; the caller owns attaching it and closing the popover once that succeeds. May throw/reject — the form shows the error inline and stays open. */
  onCreated: (shift: TournamentShift) => void | Promise<void>;
  onCancel: () => void;
}

export function CreateShiftForm({ tournamentId, tracks, onCreated, onCancel }: CreateShiftFormProps) {
  const [trackId, setTrackId] = useState<number | null>(tracks.length === 1 ? tracks[0].id : null);
  const [label, setLabel] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const track = useMemo(() => tracks.find((t) => t.id === trackId), [tracks, trackId]);
  const days = useMemo(() => trackDays(track), [track]);
  // A track that runs one day has nothing to pick, so the day is taken from
  // it rather than left to the (locked) control to report.
  const [day, setDay] = useState("");
  const resolvedDay = days.length === 1 ? days[0] : day;

  function pickTrack(nextId: number) {
    setTrackId(nextId);
    // The old day may not exist on the new track at all.
    setDay("");
  }

  async function handleSubmit() {
    if (trackId === null) { setError("Pick a track."); return; }
    if (!label.trim() || !resolvedDay || !startTime || !endTime) {
      setError("Track, day, label, start and end are all required.");
      return;
    }
    if (endTime <= startTime) { setError("End must be after the start."); return; }
    setSaving(true);
    setError(undefined);
    try {
      const shift = await tournamentShiftsApi.create(tournamentId, {
        track_id: trackId,
        label: label.trim(),
        start: fromDayAndTime(resolvedDay, startTime)!,
        end: fromDayAndTime(resolvedDay, endTime)!,
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
      <Dropdown
        label="Track" size="sm" fullWidth
        value={trackId !== null ? String(trackId) : ""}
        onChange={(v) => pickTrack(Number(v))}
        options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
        placeholder="Select a track"
        locked={tracks.length === 1}
      />
      <TrackDayPicker
        label="Day" size="sm" fullWidth
        track={track}
        value={resolvedDay}
        onChange={setDay}
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
