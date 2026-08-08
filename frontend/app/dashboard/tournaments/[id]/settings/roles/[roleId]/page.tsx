"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { membershipsApi, ALL_PERMISSIONS, PERMISSION_INFO, Permission, MembershipSlim } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { useRoleList, useRoleDrafts } from "./RoleEditorContext";
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
  // Draft lives in the layout, so it survives switching to another role.
  const { draftFor, setDraft } = useRoleDrafts();
  const { guard } = useUnsavedChanges();

  const role = roles.find((r) => r.id === roleId);
  const locked = role ? lockReason(role) !== null : false;
  const draft = role ? draftFor(role) : null;

  const [memberCount, setMemberCount] = useState(0);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    membershipsApi.list(tournamentId).then((members: MembershipSlim[]) => {
      setMemberCount(members.filter((m) => m.roles.some((r) => r.id === roleId)).length);
    }).catch(() => {});
  }, [tournamentId, roleId]);

  function togglePermission(p: Permission) {
    if (!draft) return;
    setDraft(roleId, {
      permissions: draft.permissions.includes(p)
        ? draft.permissions.filter((x) => x !== p)
        : [...draft.permissions, p],
    });
  }

  if (!role || !draft) {
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
          <Input fullWidth charset="alpha" locked={locked} value={draft.label} onChange={(e) => setDraft(roleId, { label: e.target.value })} />
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
            <Toggle checked={draft.permissions.includes(p)} onChange={() => togglePermission(p)} disabled={locked} />
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
            // Deleting drops this role's draft, but other roles may still be
            // dirty — leaving the editor still has to warn.
            guard(() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles`));
          }}
        />
      )}
    </div>
  );
}
