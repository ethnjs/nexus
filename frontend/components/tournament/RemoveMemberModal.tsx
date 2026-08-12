"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { membershipsApi, ApiError } from "@/lib/api";

interface RemoveMemberModalProps {
  tournamentId: number;
  membershipId: number;
  memberName: string;
  onClose: () => void;
  onRemoved: () => void;
}

export function RemoveMemberModal({ tournamentId, membershipId, memberName, onClose, onRemoved }: RemoveMemberModalProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    setError(undefined);
    setLoading(true);
    try {
      await membershipsApi.delete(tournamentId, membershipId);
      onRemoved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Remove member" onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Remove <strong>{memberName}</strong> from this tournament? They&apos;ll lose all roles and access.
        </p>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} onClick={handleRemove}>
            Remove member
          </Button>
        </div>
      </div>
    </Modal>
  );
}
