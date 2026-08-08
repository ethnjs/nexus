"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { membershipsApi, tournamentsApi, MembershipSlim, ApiError } from "@/lib/api";

const CONFIRM_PHRASE = "TRANSFER OWNERSHIP";

interface TransferOwnershipModalProps {
  tournamentId: number;
  currentUserId: number;
  onClose: () => void;
  onTransferred: () => void;
}

function memberLabel(m: MembershipSlim) {
  const name = [m.user.first_name, m.user.last_name].filter(Boolean).join(" ") || "Unnamed";
  return `${name} — ${m.user.email}`;
}

export function TransferOwnershipModal({ tournamentId, currentUserId, onClose, onTransferred }: TransferOwnershipModalProps) {
  const [members, setMembers] = useState<MembershipSlim[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MembershipSlim | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    membershipsApi.list(tournamentId)
      .then((all) => setMembers(all.filter((m) => m.user.id !== currentUserId)))
      .catch(() => {});
  }, [tournamentId, currentUserId]);

  const canSubmit = !!selected && confirmText === CONFIRM_PHRASE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selected) return;

    setError(undefined);
    setLoading(true);
    try {
      await tournamentsApi.transferOwnership(tournamentId, selected.user.id);
      onTransferred();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Transfer ownership" onClose={onClose} type="danger">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          The new owner gets full permissions over this tournament. You keep whatever roles you
          already hold, but lose owner-level access.
        </p>

        <Combobox
          label="New owner"
          options={members}
          getId={(m) => m.id}
          getLabel={memberLabel}
          allowFreeText={false}
          value={query}
          onChange={(text, matched) => { setQuery(text); setSelected(matched); }}
          placeholder="Search by name or email…"
        />

        <Input
          label={`Type '${CONFIRM_PHRASE}' to confirm`}
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
            Transfer ownership
          </Button>
        </div>
      </form>
    </Modal>
  );
}
