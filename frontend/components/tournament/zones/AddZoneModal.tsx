"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ApiError, type Zone, zonesApi } from "@/lib/api";

export function AddZoneModal({
  tournamentId,
  trackId,
  onClose,
  onCreated,
}: {
  tournamentId: number;
  trackId: number;
  onClose: () => void;
  onCreated: (zone: Zone) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(undefined);
    setSaving(true);
    try {
      onCreated(await zonesApi.create(tournamentId, { track_id: trackId, name: trimmed }));
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="New zone" onClose={onClose} width={380}>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <Input
          label="Name"
          placeholder="North wing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          font="sans"
          fullWidth
          required
          autoFocus
          maxLength={255}
          error={error}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>
            Create zone
          </Button>
        </div>
      </form>
    </Modal>
  );
}
