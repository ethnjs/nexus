"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { tournamentsApi, ApiError } from "@/lib/api";

const CONFIRM_PHRASE = "DELETE";

interface DeleteTournamentModalProps {
  tournamentId: number;
  tournamentName: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteTournamentModal({ tournamentId, tournamentName, onClose, onDeleted }: DeleteTournamentModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const canSubmit = confirmText === CONFIRM_PHRASE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(undefined);
    setLoading(true);
    try {
      await tournamentsApi.delete(tournamentId);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Delete tournament" onClose={onClose} type="danger">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          This permanently deletes <strong>{tournamentName}</strong> — every membership, role, sheet
          config, and event tied to it. This cannot be undone.
        </p>

        <Input
          label={`Type '${CONFIRM_PHRASE}' to confirm`}
          type="text"
          font="sans"
          fullWidth
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!canSubmit}>
            Delete tournament
          </Button>
        </div>
      </form>
    </Modal>
  );
}
