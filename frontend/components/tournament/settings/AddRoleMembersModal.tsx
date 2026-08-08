"use client";

import { useEffect, useState } from "react";
import { ApiError, MembershipSlim, membershipsApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
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

  // Debounced so typing doesn't hit the server on every keystroke — only
  // members who don't already hold this role are ever returned.
  useEffect(() => {
    const timer = setTimeout(() => {
      membershipsApi.search(tournamentId, { exclude_role_id: roleId, q: search.trim() || undefined })
        .then(setCandidates)
        .catch(() => setError("Failed to load members."));
    }, 300);
    return () => clearTimeout(timer);
  }, [tournamentId, roleId, search]);

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
        [...selected].map((membershipId) => membershipsApi.updateRoles(tournamentId, membershipId, { add: [roleId] })),
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

        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }}>
            <IconSearch size={14} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
            autoFocus
            style={{
              width: "100%", height: "36px", paddingLeft: "34px", paddingRight: "12px", boxSizing: "border-box",
              fontFamily: "var(--font-sans)", fontSize: "13px",
              background: "var(--color-bg)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)", outline: "none",
            }}
          />
        </div>

        <div style={{ maxHeight: "320px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
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
                  display: "flex", alignItems: "center", gap: "10px", padding: "6px 4px",
                  borderRadius: "var(--radius-md)", cursor: "pointer",
                  background: checked ? "var(--color-accent-subtle)" : "transparent",
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} />
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
