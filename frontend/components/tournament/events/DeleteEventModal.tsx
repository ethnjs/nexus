"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tournamentEventsApi, ApiError } from "@/lib/api";

interface DeleteEventModalProps {
  tournamentId: number;
  eventId: number;
  eventName: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteEventModal({ tournamentId, eventId, eventName, onClose, onDeleted }: DeleteEventModalProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setError(undefined);
    setLoading(true);
    try {
      await tournamentEventsApi.delete(tournamentId, eventId);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Delete event" onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Delete <strong>{eventName}</strong>? This also detaches every shift from it. This can&rsquo;t be undone.
        </p>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} onClick={handleDelete}>
            Delete event
          </Button>
        </div>
      </div>
    </Modal>
  );
}
