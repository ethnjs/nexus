"use client";

import { ReactNode, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";

/**
 * Confirm-then-act for a single risky action that isn't a delete —
 * archiving, locking an account, promoting to admin. BulkDeleteModal already
 * covers deletes (including the one-row case) and says "Delete N things" in
 * its own voice; this is the same shape for everything else.
 *
 * Stays open on failure with the server's message, rather than closing and
 * leaving the caller to surface the error somewhere the reader isn't looking.
 */
export function ConfirmModal({
  title, description, confirmLabel, variant = "danger", onConfirm, onClose, onConfirmed,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** `danger` for anything that removes access or data; `primary` for the rest. */
  variant?: "danger" | "primary";
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  /** Optional — omit it when onConfirm already applies the result itself. */
  onConfirmed?: () => void;
}) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setError(undefined);
    setLoading(true);
    try {
      await onConfirm();
      onConfirmed?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} variant={variant === "danger" ? "danger" : "normal"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {description}
        </p>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant={variant} loading={loading} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
