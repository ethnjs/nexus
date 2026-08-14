"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tournamentShiftsApi, ApiError, TournamentShift } from "@/lib/api";

interface DeleteShiftModalProps {
  tournamentId: number;
  shift: TournamentShift;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteShiftModal({ tournamentId, shift, onClose, onDeleted }: DeleteShiftModalProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setError(undefined);
    setLoading(true);
    try {
      await tournamentShiftsApi.delete(tournamentId, shift.id);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Delete shift" onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Delete <strong>{shift.label}</strong>?
          {shift.event_count > 0
            ? ` This shift is attached to ${shift.event_count} event${shift.event_count === 1 ? "" : "s"} — deleting will remove it from all of them.`
            : " It isn't attached to any events."}
        </p>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} onClick={handleDelete}>
            Delete shift
          </Button>
        </div>
      </div>
    </Modal>
  );
}
