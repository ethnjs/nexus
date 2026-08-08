"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { rolesApi, ApiError } from "@/lib/api";

interface DeleteRoleModalProps {
  tournamentId: number;
  roleId: number;
  roleLabel: string;
  membersAffected: number;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteRoleModal({ tournamentId, roleId, roleLabel, membersAffected, onClose, onDeleted }: DeleteRoleModalProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setError(undefined);
    setLoading(true);
    try {
      await rolesApi.delete(tournamentId, roleId);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Delete role" onClose={onClose} type="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Delete <strong>{roleLabel}</strong>?
          {membersAffected > 0
            ? ` ${membersAffected} member${membersAffected === 1 ? "" : "s"} will lose this role.`
            : " No members currently hold this role."}
        </p>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} onClick={handleDelete}>
            Delete role
          </Button>
        </div>
      </div>
    </Modal>
  );
}
