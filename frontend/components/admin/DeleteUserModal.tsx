"use client";

import { useEffect, useState } from "react";
import { adminUsersApi, AdminUserSlim, ApiError, OwnedTournamentRef } from "@/lib/api";
import { userName } from "@/lib/personDisplay";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { Spinner } from "@/components/ui/Spinner";

const CONFIRM_PHRASE = "DELETE";

// The admin delete confirmation. Loads the user's owned tournaments first —
// those survive the delete without an owner, and the admin should see which
// before confirming, so Delete waits on the list.
export function DeleteUserModal({ user, onDelete, onClose, onDeleted }: {
  user: AdminUserSlim;
  onDelete: (user: AdminUserSlim) => Promise<unknown>;
  onClose: () => void;
  onDeleted: (ids: number[]) => void;
}) {
  const [owned, setOwned] = useState<OwnedTournamentRef[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    adminUsersApi.get(user.id)
      .then((full) => setOwned(full.owned_tournaments))
      .catch((err: unknown) => {
        // Don't trap the admin: say the list is unknown and let them proceed.
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load their tournaments.");
        setOwned([]);
      });
  }, [user.id]);

  return (
    <BulkDeleteModal
      items={[user]}
      noun="account"
      confirmPhrase={CONFIRM_PHRASE}
      notReady={owned === null}
      description={
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span>
            Delete <strong>{userName(user)}</strong> ({user.email})? This permanently deletes
            their profile, experience, memberships and form responses. This can&rsquo;t be
            undone — lock the account instead if you only need to cut off access.
          </span>

          {owned === null ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
              <Spinner />
            </div>
          ) : loadError ? (
            <span style={{ color: "var(--color-danger)" }}>
              {loadError} Any tournaments they own will be left without an owner.
            </span>
          ) : owned.length > 0 && (
            <div>
              <span>
                These tournaments stay but will have no owner until an admin transfers them:
              </span>
              <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                {owned.map((t) => (
                  <li key={t.id} style={{ color: "var(--color-text-primary)" }}>
                    {t.name}{t.is_archived ? " (archived)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      onDelete={onDelete}
      onClose={onClose}
      onDeleted={(ids) => onDeleted(ids as number[])}
    />
  );
}
