"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { invitesApi, Invite, ApiError } from "@/lib/api";
import { HOUR_PRESETS } from "@/lib/invitePresets";

const EXPIRY_PRESETS = [
  ...HOUR_PRESETS.map(({ value, label }) => ({ value, label })),
  { value: "forever", label: "Forever" },
];

// Hours for each fixed preset — "forever" is handled separately (null expiry).
const PRESET_HOURS: Record<string, number> = Object.fromEntries(
  HOUR_PRESETS.map(({ value, hours }) => [value, hours])
);

interface CreateInviteModalProps {
  tournamentId: number;
  onClose: () => void;
  onCreated: (invite: Invite) => void;
}

export function CreateInviteModal({ tournamentId, onClose, onCreated }: CreateInviteModalProps) {
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState("1d");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setError(undefined);

    const expiresInHours = preset === "forever" ? null : PRESET_HOURS[preset];

    setLoading(true);
    try {
      const invite = await invitesApi.create(tournamentId, {
        label: label.trim() || null,
        expires_in_hours: expiresInHours,
      });
      onCreated(invite);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title="Create invite" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <Input
          label="Label"
          placeholder="e.g. Volunteer sign-up"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          font="sans"
          fullWidth
        />

        <Dropdown
          label="Expires in"
          value={preset}
          onChange={setPreset}
          options={EXPIRY_PRESETS}
          fullWidth
        />

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="primary" loading={loading} onClick={handleCreate}>
            Create invite
          </Button>
        </div>
      </div>
    </Modal>
  );
}
