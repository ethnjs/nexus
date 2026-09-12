"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { membersApi, ApiError } from "@/lib/api";

const CONFIRM_PHRASE = "LEAVE";

interface LeaveTournamentModalProps {
  tournamentId: number;
  tournamentName: string;
  onClose: () => void;
  onLeft: () => void;
}

export function LeaveTournamentModal({ tournamentId, tournamentName, onClose, onLeft }: LeaveTournamentModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const canSubmit = confirmText === CONFIRM_PHRASE;

  async function handleLeave() {
    if (!canSubmit) return;
    setError(undefined);
    setLoading(true);
    try {
      await membersApi.leaveMe(tournamentId);
      onLeft();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Leave tournament" onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          You&rsquo;ll lose your roles and access to <strong>{tournamentName}</strong>. You can
          rejoin later with an invite.
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
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} disabled={!canSubmit} onClick={handleLeave}>
            Leave tournament
          </Button>
        </div>
      </div>
    </Modal>
  );
}
