"use client";

import { useEffect, useState } from "react";
import { ApiError, MembershipFull, membersApi } from "@/lib/api";
import { useRoleLock } from "@/lib/roles/useRoleLock";
import { useTournament } from "@/lib/useTournament";
import { NO_SCOPE, WIDE_SCOPE, changeRoleScope, type RoleScope } from "@/lib/roles/roleScope";
import { RoleScopePill } from "@/components/tournament/roles/RoleScopePill";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { IconSearch } from "@/components/ui/Icons";

interface AddRoleMembersModalProps {
  tournamentId: number;
  roleId:       number;
  roleLabel:    string;
  onClose:      () => void;
  onAdded:      () => void;
}

export function AddRoleMembersModal({ tournamentId, roleId, roleLabel, onClose, onAdded }: AddRoleMembersModalProps) {
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<MembershipFull[] | null>(null);
  const [selected, setSelected] = useState<Map<number, RoleScope>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const { ownRank, bypassRankBound } = useRoleLock();
  // One track leaves nothing to choose — the grant is tournament-wide either
  // way, so simple tournaments keep the plain checklist.
  const { tracks, isSimple } = useTournament();

  // Debounced so typing doesn't hit the server on every keystroke — only
  // members who don't already hold this role are ever returned. Also drops
  // anyone who ties or outranks the current user — assigning them a role
  // would just 403 on save, so they shouldn't show up as pickable here.
  useEffect(() => {
    const timer = setTimeout(() => {
      membersApi.list(tournamentId, {
        fields: ["contact", "roles"],
        excludeRoleId: roleId,
        q: search.trim() || undefined,
        maxRank: !bypassRankBound && ownRank !== null ? ownRank : undefined,
      })
        .then(setCandidates)
        .catch(() => setError("Failed to load members."));
    }, 300);
    return () => clearTimeout(timer);
  }, [tournamentId, roleId, search, ownRank, bypassRankBound]);

  function toggle(membershipId: number) {
    setSelected((cur) => {
      const next = new Map(cur);
      // Picked at "All" — the scope a simple tournament always grants, and
      // the one to narrow down from on a multi-track tournament.
      if (next.has(membershipId)) next.delete(membershipId);
      else next.set(membershipId, WIDE_SCOPE);
      return next;
    });
  }

  function setScope(membershipId: number, scope: RoleScope) {
    setSelected((cur) => new Map(cur).set(membershipId, scope));
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(undefined);
    try {
      await Promise.all([...selected].map(([membershipId, scope]) => (
        // Candidates already exclude anyone holding the role, so every one of
        // these starts from nothing.
        changeRoleScope(tournamentId, membershipId, roleId, NO_SCOPE, scope)
      )));
      onAdded();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to add members.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add members" onClose={onClose} width={440}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Select members to add to role <strong>{roleLabel}</strong>.
        </p>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search members"
          icon={<IconSearch size={14} />}
          font="sans"
          size="sm"
          fullWidth
          autoFocus
        />

        <div style={{ height: "320px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
          {candidates === null ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
              <Spinner size="sm" />
            </div>
          ) : candidates.length === 0 && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "8px 4px" }}>
              No members to add.
            </p>
          )}
          {candidates?.map((m) => {
            const checked = selected.has(m.id);
            const name = `${m.user.first_name ?? ""} ${m.user.last_name ?? ""}`.trim() || m.user.email;
            return (
              <label
                key={m.id}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "6px 4px 6px 12px",
                  borderRadius: "var(--radius-md)", cursor: "pointer",
                  background: checked ? "var(--color-accent-subtle)" : "transparent",
                }}
              >
                <Checkbox checked={checked} onChange={() => toggle(m.id)} />
                <AvatarCircle user={m.user} size={28} />
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.user.email}
                  </span>
                </div>
                {/* Only once picked: a pill on every row would offer a where
                    for members who are not being added at all. */}
                {!isSimple && checked && (
                  <span
                    style={{ flexShrink: 0, paddingRight: "8px" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <RoleScopePill
                      scope={selected.get(m.id) ?? WIDE_SCOPE}
                      tracks={tracks}
                      size="md"
                      title="Where this member will hold the role"
                      onChange={(scope) => setScope(m.id, scope)}
                    />
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" variant="primary" loading={saving} disabled={selected.size === 0} onClick={handleAdd}>
            Add {selected.size > 0 ? selected.size : ""} member{selected.size === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
