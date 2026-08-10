"use client";

import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { EXPIRY_PRESETS } from "@/lib/invitePresets";

interface InviteFieldsProps {
  label: string;
  onLabelChange: (value: string) => void;
  preset: string;
  onPresetChange: (value: string) => void;
}

// Label + expiry-preset fields for creating a new invite — shared between
// CreateInviteModal and StaffInviteModal's "create new invite" branch.
// Controlled from the parent, which owns submission.
export function InviteFields({ label, onLabelChange, preset, onPresetChange }: InviteFieldsProps) {
  return (
    <>
      <Input
        label="Label"
        placeholder="e.g. Volunteer sign-up"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        font="sans"
        fullWidth
      />

      <Dropdown
        label="Expires in"
        value={preset}
        onChange={onPresetChange}
        options={EXPIRY_PRESETS}
        fullWidth
      />
    </>
  );
}
