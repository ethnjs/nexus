"use client";

import { useEffect, useState } from "react";
import { ApiError, MembershipSlim, Role, membershipsApi } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { Spinner } from "@/components/ui/Spinner";
import { IconSearch, IconX } from "@/components/ui/Icons";
import { AddRoleMembersModal } from "@/components/tournament/settings/AddRoleMembersModal";

interface RoleMembersTabProps {
  tournamentId: number;
  role:         Role;
  locked:       boolean;
  // Lets the parent resync its own member-count display (nav tab label,
  // Danger Zone helper) after this tab adds/removes someone.
  onChanged?:   () => void;
}

export function RoleMembersTab({ tournamentId, role, locked, onChanged }: RoleMembersTabProps) {
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<MembershipSlim[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadKey, setLoadKey] = useState(0);

  // Debounced so search doesn't hit the server on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      membershipsApi.search(tournamentId, { role_id: role.id, q: search.trim() || undefined })
        .then(setMembers)
        .catch(() => setError("Failed to load members."));
    }, 300);
    return () => clearTimeout(timer);
  }, [tournamentId, role.id, search, loadKey]);

  function refetch() {
    setLoadKey((k) => k + 1);
    onChanged?.();
  }

  async function handleRemove(membershipId: number) {
    setRemovingId(membershipId);
    setError(undefined);
    try {
      await membershipsApi.updateRoles(tournamentId, membershipId, { remove: [role.id] });
      refetch();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }}>
            <IconSearch size={14} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
            style={{
              width: "100%", height: "36px", paddingLeft: "34px", paddingRight: "12px", boxSizing: "border-box",
              fontFamily: "var(--font-sans)", fontSize: "13px",
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)", outline: "none",
            }}
          />
        </div>
        {!locked && (
          <Button type="button" variant="primary" size="md" onClick={() => setShowAdd(true)}>
            Add Members
          </Button>
        )}
      </div>

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {error}
        </p>
      )}

      <div style={{
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)",
        background: "var(--color-surface)", overflow: "hidden",
      }}>
        {members === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
            <Spinner size="sm" />
          </div>
        ) : members.length === 0 ? (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "16px" }}>
            {search ? "No members match your search." : "No members hold this role yet."}
          </p>
        ) : (
          members.map((m, i) => {
            const name = `${m.user.first_name ?? ""} ${m.user.last_name ?? ""}`.trim() || m.user.email;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                  borderBottom: i === members.length - 1 ? "none" : "1px solid var(--color-border)",
                }}
              >
                <AvatarCircle user={m.user} size={30} />
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.user.email}
                  </span>
                </div>
                {!locked && (
                  <Button
                    type="button" variant="secondary" size="sm"
                    loading={removingId === m.id}
                    onClick={() => handleRemove(m.id)}
                    title="Remove from role"
                    style={{ width: "28px", height: "28px", padding: 0, color: "var(--color-danger)" }}
                  >
                    <IconX size={12} />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      {showAdd && (
        <AddRoleMembersModal
          tournamentId={tournamentId}
          roleId={role.id}
          roleLabel={role.label}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); refetch(); }}
        />
      )}
    </div>
  );
}
