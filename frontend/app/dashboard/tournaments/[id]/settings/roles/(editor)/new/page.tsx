"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { rolesApi, ApiError, ALL_PERMISSIONS, PERMISSION_INFO, Permission } from "@/lib/api";
import { useRoleList } from "../RoleFieldSaveContext";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";

export default function NewRolePage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { refreshRoles } = useRoleList();

  const [label, setLabel] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  function togglePermission(p: Permission) {
    setPermissions((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function handleCreate() {
    if (!label.trim()) { setNameError("Name is required."); return; }
    setSaving(true);
    setNameError(undefined);
    setSubmitError(undefined);
    try {
      // Bottom of the hierarchy by default — the next drag-reorder cleanly
      // renumbers it, no need to compute a "correct" rank up front.
      const role = await rolesApi.create(tournamentId, { label: label.trim(), permissions, rank: 999999 });
      await refreshRoles();
      router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`);
    } catch (err: unknown) {
      setSubmitError(err instanceof ApiError ? err.message : "Failed to create role.");
      setSaving(false);
    }
  }

  return (
    <div>
      <SettingsSection title="Details">
        <SettingsRow label="Name" last>
          <Input fullWidth charset="alpha" value={label} onChange={(e) => setLabel(e.target.value)} error={nameError} />
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
            <Toggle checked={permissions.includes(p)} onChange={() => togglePermission(p)} />
          </SettingsRow>
        ))}
      </SettingsSection>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}>
        {submitError && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {submitError}
          </span>
        )}
        <Button type="button" variant="primary" loading={saving} onClick={handleCreate}>
          Create Role
        </Button>
      </div>
    </div>
  );
}
