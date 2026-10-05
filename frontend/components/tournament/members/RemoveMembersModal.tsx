"use client";

import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { membersApi, MembershipFull } from "@/lib/api";

interface RemoveMembersModalProps {
  tournamentId: number;
  /** The selection's members this viewer can remove. */
  members: MembershipFull[];
  /** Selected but not removable by this viewer (they outrank them, or the owner). */
  lockedCount: number;
  /** The viewer's own row was selected — leaving has its own flow. */
  includesSelf: boolean;
  onClose: () => void;
  /** The ids that actually went — on a partial failure the modal stays open. */
  onRemoved: (ids: number[]) => void;
}

// The selection toolbar's Remove. Removes whoever it can and names who it
// skips, rather than refusing the whole batch over one row it can't touch.
export function RemoveMembersModal({
  tournamentId, members, lockedCount, includesSelf, onClose, onRemoved,
}: RemoveMembersModalProps) {
  return (
    <BulkDeleteModal
      items={members}
      noun="member"
      verb="Remove"
      verbPast="removed"
      // Always typed: a batch is easy to over-select, and there's no undo.
      confirmPhrase="remove"
      onDelete={(m) => membersApi.delete(tournamentId, m.id)}
      onClose={onClose}
      onDeleted={onRemoved}
      description={
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span>
            Remove <strong>{members.length} member{members.length === 1 ? "" : "s"}</strong> from this
            tournament? They&apos;ll lose all roles and access.
          </span>
          {lockedCount > 0 && (
            <span>
              {lockedCount} selected member{lockedCount === 1 ? "" : "s"} can&apos;t be removed by you and will be skipped.
            </span>
          )}
          {includesSelf && <span>You&apos;re skipped too — leave from General settings instead.</span>}
        </div>
      }
    />
  );
}
