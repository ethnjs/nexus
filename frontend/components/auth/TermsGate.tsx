"use client";

import { useState } from "react";
import { TermsAgreement } from "@/components/auth/TermsAgreement";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ApiError, type UserMeSlim, usersApi } from "@/lib/api";

/** Blocks the app until the signed-in user accepts the current Terms and Privacy Policy. */
export function TermsGate({
  onAccepted,
  onSignOut,
}: {
  onAccepted: (user: UserMeSlim) => void;
  onSignOut: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setSaving(true);
    setError(null);
    try {
      onAccepted(await usersApi.acceptTerms());
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong :(");
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Terms of Service and Privacy Policy"
      onClose={() => {}}
      closeOnOverlayClick={false}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onSignOut} disabled={saving}>
            Sign out
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={accept}
            disabled={!checked}
            loading={saving}
          >
            Continue
          </Button>
        </div>
      }
    >
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          color: "var(--color-text-secondary)",
          marginBottom: "16px",
        }}
      >
        To keep using NEXUS, please review and accept our Terms of Service and Privacy Policy.
      </p>
      <TermsAgreement checked={checked} onChange={setChecked} />
      {error && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            marginTop: "12px",
          }}
        >
          {error}
        </p>
      )}
    </Modal>
  );
}
