"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { usersApi, ApiError } from "@/lib/api";

const CONFIRM_PHRASE = "DELETE";

interface DeleteAccountModalProps {
  onClose: () => void;
}

export function DeleteAccountModal({ onClose }: DeleteAccountModalProps) {
  const [step, setStep] = useState<"warning" | "confirm">("warning");
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
      await usersApi.deleteAccount(password);
      // Backend already revoked the session — local auth state is stale,
      // so a full reload (not router.push) is needed to clear it.
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  if (step === "warning") {
    return (
      <Modal title="Delete account" onClose={onClose} type="danger">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            This permanently deletes your account and everything tied to it. It cannot be undone.
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            If you&rsquo;re currently part of any tournaments, deleting your account will also remove
            you from them.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="danger" onClick={() => setStep("confirm")}>Continue</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Delete account" onClose={onClose} type="danger">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Enter your password and type <strong>{CONFIRM_PHRASE}</strong> to permanently delete your account.
        </p>

        <Input
          label="Current password"
          type="password"
          font="sans"
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
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
          <Button type="button" variant="secondary" onClick={() => setStep("warning")}>Back</Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!canSubmit}>
            Delete account
          </Button>
        </div>
      </form>
    </Modal>
  );
}
