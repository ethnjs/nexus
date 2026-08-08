"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { rolesApi, membershipsApi, ApiError, ALL_PERMISSIONS, PERMISSION_INFO, Permission, MembershipSlim } from "@/lib/api";
import { useRoleList, useRegisterRoleFieldSave } from "../RoleFieldSaveContext";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { DeleteRoleModal } from "@/components/tournament/settings/DeleteRoleModal";

export default function RoleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const roleId = Number(params.roleId);
  const { roles, refreshRoles, lockReason } = useRoleList();

  const role = roles.find((r) => r.id === roleId);
  const locked = role ? lockReason(role) !== null : false;

  const [label, setLabel] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [memberCount, setMemberCount] = useState(0);
  const [showDelete, setShowDelete] = useState(false);

  // Resync the draft whenever the underlying role changes — including right
  // after this page's own save adopts the server's response.
  useEffect(() => {
    if (role) { setLabel(role.label); setPermissions(role.permissions as Permission[]); }
  }, [role]);

  useEffect(() => {
    membershipsApi.list(tournamentId).then((members: MembershipSlim[]) => {
      setMemberCount(members.filter((m) => m.roles.some((r) => r.id === roleId)).length);
    }).catch(() => {});
  }, [tournamentId, roleId]);

  const isDirty = !!role && (label.trim() !== role.label || JSON.stringify([...permissions].sort()) !== JSON.stringify([...role.permissions].sort()));

  function togglePermission(p: Permission) {
    setPermissions((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  const fieldSave = useMemo(() => (
    locked || !isDirty ? null : {
      isDirty: true,
      saving,
      error,
      save: async () => {
        setSaving(true);
        setError(undefined);
        try {
          await rolesApi.update(tournamentId, roleId, { label: label.trim(), permissions });
          await refreshRoles();
        } catch (err: unknown) {
          setError(err instanceof ApiError ? err.message : "Failed to save role.");
        } finally {
          setSaving(false);
        }
      },
      cancel: () => {
        if (role) { setLabel(role.label); setPermissions(role.permissions as Permission[]); }
        setError(undefined);
      },
    }
  ), [locked, isDirty, saving, error, tournamentId, roleId, label, permissions, refreshRoles, role]);

  useRegisterRoleFieldSave(fieldSave);

  if (!role) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <SettingsSection title="Details">
        <SettingsRow label="Name" last>
          <Input fullWidth charset="alpha" locked={locked} value={label} onChange={(e) => setLabel(e.target.value)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Permissions">
        {ALL_PERMISSIONS.map((p, i) => (
          <SettingsRow
            key={p}
            label={PERMISSION_INFO[p].label}
            helper={PERMISSION_INFO[p].description}
            last={i === ALL_PERMISSIONS.length - 1}
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
          >
            <Toggle checked={permissions.includes(p)} onChange={() => togglePermission(p)} disabled={locked} />
          </SettingsRow>
        ))}
      </SettingsSection>

      {!locked && (
        <SettingsSection title="Danger Zone" variant="danger">
          <SettingsRow
            label="Delete role"
            helper={memberCount > 0 ? `${memberCount} member${memberCount === 1 ? "" : "s"} will lose this role.` : "No members currently hold this role."}
            last
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
          >
            <Button type="button" variant="secondary" size="md" onClick={() => setShowDelete(true)} style={{ color: "var(--color-danger)" }}>
              Delete
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}

      {showDelete && (
        <DeleteRoleModal
          tournamentId={tournamentId}
          roleId={role.id}
          roleLabel={role.label}
          membersAffected={memberCount}
          onClose={() => setShowDelete(false)}
          onDeleted={async () => {
            await refreshRoles();
            router.push(`/dashboard/tournaments/${tournamentId}/settings/roles`);
          }}
        />
      )}
    </div>
  );
}
