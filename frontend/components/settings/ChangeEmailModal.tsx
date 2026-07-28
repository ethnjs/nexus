"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi, ApiError } from "@/lib/api";
import { validateEmail } from "@/lib/auth";

const COOLDOWN_SECONDS = 60;

interface ChangeEmailModalProps {
  currentEmail: string;
  onClose: () => void;
}

export function ChangeEmailModal({ currentEmail, onClose }: ChangeEmailModalProps) {
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (sentAt === null) return;

    function tick() {
      const remaining = COOLDOWN_SECONDS - Math.floor((Date.now() - sentAt!) / 1000);
      setCooldown(Math.max(0, remaining));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

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
      await authApi.requestEmailChange(newEmail);
      setSentAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Failed to send confirmation email.");
    } finally {
      setSending(false);
    }
  }

  const onCooldown = sentAt !== null && cooldown > 0;

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

        {sentAt !== null && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
            {onCooldown
              ? `Verification sent to ${newEmail}. Didn't receive it? Try again in ${cooldown}s.`
              : `Verification sent to ${newEmail}. Didn't receive it? You can resend now.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
