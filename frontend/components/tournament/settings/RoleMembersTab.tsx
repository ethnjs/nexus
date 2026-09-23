"use client";

import { useEffect, useState } from "react";
import { ApiError, MembershipFull, Role, membersApi } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useRoleLock } from "@/lib/roles/useRoleLock";
import { useTournament } from "@/lib/useTournament";
import { NO_SCOPE, changeRoleScope, scopeOf, type RoleScope } from "@/lib/roles/roleScope";
import { RoleScopePill } from "@/components/tournament/roles/RoleScopePill";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { Spinner } from "@/components/ui/Spinner";
import { IconLock, IconSearch, IconX } from "@/components/ui/Icons";
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
  const [members, setMembers] = useState<MembershipFull[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadKey, setLoadKey] = useState(0);

  const { user: currentUser } = useAuth();
  const { ownRank, bypassRankBound } = useRoleLock();
  // One track means "held here" and "held everywhere" are the same, so the
  // scope pill only earns its place on a multi-track tournament.
  const { tracks, isSimple } = useTournament();

  // Same rank-authority check the backend enforces (validate_role_action
  // check 2) — a member who strictly outranks the actor would just 403 on
  // remove, so the X is locked instead of letting that happen. Ties are
  // fine here: two peers at the same rank can still edit each other.
  function outranksActor(m: MembershipFull): boolean {
    if (bypassRankBound || m.user.id === currentUser?.id || ownRank === null) return false;
    if ((m.roles ?? []).length === 0) return false;
    return Math.min(...(m.roles ?? []).map((r) => r.rank)) < ownRank;
  }

  // Debounced so search doesn't hit the server on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      membersApi.list(tournamentId, { fields: ["contact", "roles"], roleId: role.id, q: search.trim() || undefined })
        .then(setMembers)
        .catch(() => setError("Failed to load members."));
    }, 300);
    return () => clearTimeout(timer);
  }, [tournamentId, role.id, search, loadKey]);

  function refetch() {
    setLoadKey((k) => k + 1);
    onChanged?.();
  }

  /** Where this member holds the role. Every row here holds it somewhere —
   *  the list is filtered by it — so an empty scope only means a stale row. */
  function scopeFor(m: MembershipFull): RoleScope {
    const held = (m.roles ?? []).find((r) => r.id === role.id);
    return held ? scopeOf(held) : NO_SCOPE;
  }

  async function moveScope(m: MembershipFull, to: RoleScope) {
    setRemovingId(m.id);
    setError(undefined);
    try {
      await changeRoleScope(tournamentId, m.id, role.id, scopeFor(m), to);
      refetch();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to update member.");
    } finally {
      setRemovingId(null);
    }
  }

  /** The "x" drops the role wherever it is held, not just tournament-wide. */
  const handleRemove = (m: MembershipFull) => moveScope(m, NO_SCOPE);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
        <div style={{ flex: 1 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Search members"
            icon={<IconSearch size={14} />}
            font="sans"
            variant="secondary"
            size="md"
            fullWidth
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
            const memberLocked = outranksActor(m);
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
                {!isSimple && (
                  <span style={{ flexShrink: 0 }}>
                    <RoleScopePill
                      scope={scopeFor(m)}
                      tracks={tracks}
                      editable={!locked && !memberLocked}
                      size="md"
                      title="Where this member holds the role"
                      onChange={(scope) => moveScope(m, scope)}
                    />
                  </span>
                )}
                {!locked && (
                  memberLocked ? (
                    <span
                      title="This member outranks you — you can't remove them from this role."
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "28px", height: "28px", flexShrink: 0,
                        color: "var(--color-text-tertiary)", opacity: 0.7,
                      }}
                    >
                      <IconLock size={12} />
                    </span>
                  ) : (
                    <Button
                      type="button" variant="secondary" size="sm"
                      loading={removingId === m.id}
                      onClick={() => handleRemove(m)}
                      title="Remove from role"
                      style={{ width: "28px", height: "28px", padding: 0, color: "var(--color-danger)" }}
                    >
                      <IconX size={12} />
                    </Button>
                  )
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
