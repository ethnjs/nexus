"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface SelfRemoveRedirectModalProps {
  tournamentId: number;
  isOwner: boolean;
  onClose: () => void;
}

// Removing yourself from a tournament isn't a roster action — the backend's
// DELETE .../members/{id}/ (kick) route treats the owner's own row as
// untouchable and doesn't carry the ownership-transfer guard leave_tournament
// (DELETE .../members/me/) has. General settings' "Leave tournament" flow
// is the one place that calls members/me/, so self-removal from the
// members page always routes there instead of opening RemoveMemberModal.
export function SelfRemoveRedirectModal({ tournamentId, isOwner, onClose }: SelfRemoveRedirectModalProps) {
  const router = useRouter();

  function goToSettings() {
    router.push(`/dashboard/tournaments/${tournamentId}/settings/general`);
    onClose();
  }

  return (
    <Modal title="Leave this tournament" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {isOwner
            ? "You own this tournament, so you can't remove yourself here — transfer ownership first, from General Settings."
            : "You can't remove yourself from the roster here — leave the tournament from General Settings instead."}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={goToSettings}>
            Go to General Settings
          </Button>
        </div>
      </div>
    </Modal>
  );
}
