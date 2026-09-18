"use client";

import { useState } from "react";
import {
  buildingsApi, ApiError,
  type TournamentBuilding, type TournamentTrack,
} from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CheckboxList } from "@/components/ui/CheckboxList";

/**
 * Create or rename a building, and pick the tracks it's available on.
 *
 * Both in one modal because a building with no tracks is inert — it can hold
 * nothing — so "name it" and "say where it's in use" are one decision rather
 * than a create followed by a second edit nobody would remember to make.
 */
export function BuildingFormModal({
  tournamentId, building, tracks, defaultTrackId, onClose, onSaved,
}: {
  tournamentId: number;
  /** null = creating. */
  building: TournamentBuilding | null;
  tracks: TournamentTrack[];
  /** The tab the TD is on — a new building is tagged with it by default,
   *  since that is the board they are looking at while creating it. */
  defaultTrackId: number | null;
  onClose: () => void;
  onSaved: (building: TournamentBuilding) => void;
}) {
  const [name, setName] = useState(building?.name ?? "");
  const [trackIds, setTrackIds] = useState<number[]>(
    building?.track_ids ?? (defaultTrackId !== null ? [defaultTrackId] : []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(undefined);
    try {
      const saved = building
        ? await buildingsApi.update(tournamentId, building.id, { name: name.trim(), track_ids: trackIds })
        : await buildingsApi.create(tournamentId, { name: name.trim(), track_ids: trackIds });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // Untagging a track blanks the location of every event placed here on it —
  // the composite FK makes that pairing impossible to keep, so the backend
  // clears it rather than refusing the write.
  const untagging = building
    ? building.track_ids.filter((id) => !trackIds.includes(id))
    : [];

  return (
    <Modal title={building ? "Edit building" : "Add building"} onClose={onClose} width={420}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Input
          label="Name" required fullWidth autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Rowland Hall"
        />

        <div>
          <div style={{
            fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.07em",
            color: "var(--color-text-tertiary)", marginBottom: "8px",
          }}>
            Available on
          </div>
          <CheckboxList
            options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
            value={trackIds.map(String)}
            onChange={(v) => {
              const id = Number(v);
              setTrackIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
            }}
          />
          {tracks.length === 0 && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
              No tracks yet.
            </p>
          )}
        </div>

        {untagging.length > 0 && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-warning)", margin: 0 }}>
            Events placed here on {untagging.length === 1 ? "that track" : "those tracks"} will be moved back to unplaced.
          </p>
        )}

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", margin: 0 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : building ? "Save" : "Add building"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
