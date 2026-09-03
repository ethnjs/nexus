"use client";

import { useEffect, useState } from "react";
import { ApiError, MembershipSlim, membersApi } from "@/lib/api";
import { useRoleLock } from "@/lib/roles/useRoleLock";
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
  const [candidates, setCandidates] = useState<MembershipSlim[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const { ownRank, bypassRankBound } = useRoleLock();

  // Debounced so typing doesn't hit the server on every keystroke — only
  // members who don't already hold this role are ever returned. Also drops
  // anyone who ties or outranks the current user — assigning them a role
  // would just 403 on save, so they shouldn't show up as pickable here.
  useEffect(() => {
    const timer = setTimeout(() => {
      membersApi.list(tournamentId, {
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
      const next = new Set(cur);
      if (next.has(membershipId)) next.delete(membershipId);
      else next.add(membershipId);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(undefined);
    try {
      await Promise.all(
        [...selected].map((membershipId) => membersApi.updateRoles(tournamentId, membershipId, { add: [roleId] })),
      );
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
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.user.email}
                  </span>
                </div>
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
