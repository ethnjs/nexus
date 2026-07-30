"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi, ApiError, EmailPendingChange } from "@/lib/api";
import { validateEmail } from "@/lib/auth";

interface ChangeEmailModalProps {
  currentEmail: string;
  pendingChange: EmailPendingChange;
  onChange: (next: EmailPendingChange) => void;
  onClose: () => void;
}

export function ChangeEmailModal({ currentEmail, pendingChange, onChange, onClose }: ChangeEmailModalProps) {
  const [newEmail, setNewEmail] = useState(pendingChange.new_email ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const canResendAt = pendingChange.can_resend_at ? new Date(pendingChange.can_resend_at).getTime() : null;
  const onCooldown = canResendAt !== null && now < canResendAt;
  const cooldownSeconds = onCooldown ? Math.ceil((canResendAt! - now) / 1000) : 0;

  async function handleSend() {
    const err = validateEmail(newEmail);
    if (err) {
      setError(err);
      return;
    }
    if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setError("That's already your current email.");
      return;
    }

    setError(undefined);
    setSending(true);
    try {
      const result = await authApi.requestEmailChange(newEmail);
      onChange(result);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Failed to send confirmation email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Change email" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
          Currently <strong>{currentEmail}</strong>. We'll send a confirmation link to the new address —
          your email won't change until you click it.
        </p>

        <Input
          label="New email"
          fullWidth
          font="sans"
          type="email"
          value={newEmail}
          disabled={onCooldown}
          onChange={(e) => {
            setNewEmail(e.target.value);
            setError(undefined);
          }}
          error={error}
          placeholder="new@example.com"
          autoFocus
        />

        <div style={{ marginTop: "8px" }}>
          <Button
            type="button"
            variant="primary"
            onClick={handleSend}
            loading={sending}
            disabled={!newEmail || onCooldown}
          >
            Send confirmation
          </Button>
        </div>

        {pendingChange.new_email && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
            {onCooldown
              ? `Verification sent to ${pendingChange.new_email}. Didn't receive it? Try again in ${cooldownSeconds}s.`
              : `Verification sent to ${pendingChange.new_email}. Didn't receive it? You can resend now.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
