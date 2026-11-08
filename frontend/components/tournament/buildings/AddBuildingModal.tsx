"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ApiError, buildingsApi, type TournamentBuilding } from "@/lib/api";

export function AddBuildingModal({
  tournamentId,
  trackIds,
  onClose,
  onCreated,
}: {
  tournamentId: number;
  /** Every competition day — a new building starts on all of them. */
  trackIds: number[];
  onClose: () => void;
  onCreated: (building: TournamentBuilding) => void;
}) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(undefined);
    setSaving(true);
    try {
      onCreated(
        await buildingsApi.create(tournamentId, {
          name: trimmed,
          short_name: shortName.trim() || null,
          track_ids: trackIds,
        }),
      );
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add building" onClose={onClose} width={380}>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <Input
          label="Name"
          placeholder="Rowland Hall"
          value={name}
          onChange={(e) => setName(e.target.value)}
          font="sans"
          fullWidth
          required
          autoFocus
          maxLength={255}
          error={error}
        />
        <Input
          label="Short name (optional)"
          placeholder="RH"
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          font="sans"
          fullWidth
          maxLength={64}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>
            Add building
          </Button>
        </div>
      </form>
    </Modal>
  );
}
