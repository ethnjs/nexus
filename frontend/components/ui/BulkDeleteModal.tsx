"use client";

import { ReactNode, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";

/** Confirm-and-delete for one row or a whole selection. Deletes run in
 *  parallel; on a partial failure the modal stays open saying how many failed. */
export function BulkDeleteModal<T extends { id: number | string }>({
  items, noun, description, onDelete, onClose, onDeleted,
}: {
  items: T[];
  /** Singular — "shift", "event". Becomes "3 shifts" for several. */
  noun: string;
  description: ReactNode;
  onDelete: (item: T) => Promise<unknown>;
  onClose: () => void;
  /** The ids that actually went. */
  onDeleted: (ids: T["id"][]) => void;
}) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const label = items.length === 1 ? noun : `${items.length} ${noun}s`;

  async function handleDelete() {
    setError(undefined);
    setLoading(true);
    const outcomes = await Promise.allSettled(items.map(onDelete));
    const deleted = items.filter((_, i) => outcomes[i].status === "fulfilled").map((item) => item.id);
    if (deleted.length > 0) onDeleted(deleted);

    const failure = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    if (!failure) { onClose(); return; }
    const reason = failure.reason instanceof ApiError ? failure.reason.message : "Something went wrong. Try again.";
    setError(items.length === 1 ? reason : `${items.length - deleted.length} couldn't be deleted: ${reason}`);
    setLoading(false);
  }

  return (
    <Modal title={`Delete ${label}`} onClose={onClose} variant="danger">
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
          <Button type="button" variant="danger" loading={loading} onClick={handleDelete}>
            Delete {label}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
