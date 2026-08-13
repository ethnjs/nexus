"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { usersApi, ApiError } from "@/lib/api";

const CONFIRM_PHRASE = "DEACTIVATE";

interface DeactivateAccountModalProps {
  onClose: () => void;
}

export function DeactivateAccountModal({ onClose }: DeactivateAccountModalProps) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const canSubmit = password.length > 0 && confirmText === CONFIRM_PHRASE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(undefined);
    setLoading(true);
    try {
      await usersApi.deactivateAccount(password);
      // Backend already revoked the session — local auth state is stale,
      // so a full reload (not router.push) is needed to clear it.
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Deactivate account" onClose={onClose} variant="danger">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Your account will be deactivated and every session signed out. This is reversible —
          contact support to reactivate.
        </p>

        <Input
          label="Current password"
          type="password"
          font="sans"
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <Input
          label={`Type ${CONFIRM_PHRASE} to confirm`}
          type="text"
          font="sans"
          fullWidth
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!canSubmit}>
            Deactivate account
          </Button>
        </div>
      </form>
    </Modal>
  );
}
