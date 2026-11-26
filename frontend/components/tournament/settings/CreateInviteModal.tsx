"use client";

import { useState } from "react";
import { InviteEmailForm } from "@/components/tournament/settings/InviteEmailForm";
import { InviteFields } from "@/components/tournament/settings/InviteFields";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { Modal } from "@/components/ui/Modal";
import { ApiError, type Invite, invitesApi, type Role } from "@/lib/api";
import { PRESET_HOURS } from "@/lib/invitePresets";

interface CreateInviteModalProps {
  tournamentId: number;
  /** Roles the invite may grant, or null when the viewer can't set roles. */
  grantableRoles: Role[] | null;
  onClose: () => void;
  onCreated: (invite: Invite) => void;
}

export function CreateInviteModal({
  tournamentId,
  grantableRoles,
  onClose,
  onCreated,
}: CreateInviteModalProps) {
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState("1d");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  async function handleCreate() {
    setError(undefined);

    const expiresInHours = preset === "forever" ? null : PRESET_HOURS[preset];

    setLoading(true);
    try {
      const invite = await invitesApi.create(tournamentId, {
        label: label.trim() || null,
        expires_in_hours: expiresInHours,
        role_ids: roleIds.map(Number),
      });
      onCreated(invite);
      setCreated(invite);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <Modal title="Email this invite?" onClose={onClose}>
        <InviteEmailForm
          tournamentId={tournamentId}
          inviteId={created.id}
          onClose={onClose}
          cancelLabel="Skip"
        />
      </Modal>
    );
  }

  return (
    <Modal title="Create invite" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <InviteFields
          label={label}
          onLabelChange={setLabel}
          preset={preset}
          onPresetChange={setPreset}
        />

        {grantableRoles && (
          <Dropdown
            multiple
            label="Roles"
            placeholder="No roles"
            values={roleIds}
            onChangeValues={setRoleIds}
            options={grantableRoles.map((r) => ({ value: String(r.id), label: r.label }))}
            helper="Everyone who joins with this invite gets these roles. Only roles without permissions can be added."
            emptyMessage="No roles without permissions yet"
            fullWidth
          />
        )}

        {error && (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={loading} onClick={handleCreate}>
            Create invite
          </Button>
        </div>
      </div>
    </Modal>
  );
}
