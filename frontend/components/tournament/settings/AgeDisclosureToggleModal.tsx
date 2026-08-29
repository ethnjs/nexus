"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { tournamentsApi, Tournament, ApiError } from "@/lib/api";

const CONFIRM_PHRASE = "ENABLE";

interface AgeDisclosureToggleModalProps {
  tournamentId: number;
  flag: "collect_is_over_18" | "collect_is_over_21";
  thresholdLabel: string; // "18+" or "21+"
  onClose: () => void;
  onDone: (updated: Tournament) => void;
}

// Confirms turning collection ON — same type-to-confirm pattern as
// Archive/Leave, since this has a comparable blast radius: it blocks every
// existing member's access to the tournament until they answer, and a
// decline is a real, if soft, departure. Turning collection OFF needs no
// such warning (nothing is destroyed, no one loses access) and applies
// immediately from the settings page without this modal.
export function AgeDisclosureToggleModal({
  tournamentId, flag, thresholdLabel, onClose, onDone,
}: AgeDisclosureToggleModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const canSubmit = confirmText === CONFIRM_PHRASE;

  async function handleEnable() {
    if (!canSubmit) return;
    setError(undefined);
    setLoading(true);
    try {
      const updated = await tournamentsApi.update(tournamentId, { [flag]: true });
      onDone(updated);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title={`Collect ${thresholdLabel} status`} onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Every current member will be prompted to consent the next time they visit this
          tournament, before they can do anything else here. A member who declines loses access
          to this tournament — their existing responses stay on file, and they can rejoin any
          time by allowing.
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
          <Button type="button" variant="danger" loading={loading} disabled={!canSubmit} onClick={handleEnable}>
            Enable collection
          </Button>
        </div>
      </div>
    </Modal>
  );
}
