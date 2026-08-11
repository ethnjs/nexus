"use client";

import { useState } from "react";
import { ALL_PERMISSIONS, PERMISSION_INFO, Permission, Role } from "@/lib/api";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { DeleteRoleModal } from "@/components/tournament/settings/DeleteRoleModal";

export interface RoleDraft {
  label:       string;
  permissions: Permission[];
}

interface RoleEditorFormProps {
  tournamentId: number;
  role:         Role;
  draft:        RoleDraft;
  setDraft:     (roleId: number, patch: Partial<RoleDraft>) => void;
  locked:       boolean;
  memberCount:  number;
  onDeleted:    () => void;
  /** Set for a role that hasn't been created yet — removing it is local, so no modal and no DELETE. */
  onDiscard?:   () => void;
}

export function RoleEditorForm({ tournamentId, role, draft, setDraft, locked, memberCount, onDeleted, onDiscard }: RoleEditorFormProps) {
  const [showDelete, setShowDelete] = useState(false);

  function togglePermission(p: Permission) {
    setDraft(role.id, {
      permissions: draft.permissions.includes(p)
        ? draft.permissions.filter((x) => x !== p)
        : [...draft.permissions, p],
    });
  }

  return (
    <div>
      <SettingsSection title="Details">
        <SettingsRow label="Name" last>
          <Input fullWidth charset="alpha" locked={locked} value={draft.label} onChange={(e) => setDraft(role.id, { label: e.target.value })} />
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
            <Toggle checked={draft.permissions.includes(p)} onChange={() => togglePermission(p)} locked={locked} />
          </SettingsRow>
        ))}
      </SettingsSection>

      {!locked && (
        <SettingsSection title="Danger Zone" variant="danger">
          <SettingsRow
            label={onDiscard ? "Discard role" : "Delete role"}
            helper={
              onDiscard
                ? "This role hasn't been created yet — discarding removes it right away."
                : memberCount > 0
                  ? `${memberCount} member${memberCount === 1 ? "" : "s"} will lose this role.`
                  : "No members currently hold this role."
            }
            last
            contentStyle={{ display: "flex", justifyContent: "flex-end" }}
          >
            <Button
              type="button" variant="secondary" size="md"
              onClick={() => (onDiscard ? onDiscard() : setShowDelete(true))}
              style={{ color: "var(--color-danger)" }}
            >
              {onDiscard ? "Discard" : "Delete"}
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
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
