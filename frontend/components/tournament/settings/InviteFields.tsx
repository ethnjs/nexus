"use client";

import { Dropdown } from "@/components/ui/Dropdown";
import { Input } from "@/components/ui/Input";
import { EXPIRY_PRESETS } from "@/lib/invitePresets";

interface InviteFieldsProps {
  label: string;
  onLabelChange: (value: string) => void;
  preset: string;
  onPresetChange: (value: string) => void;
}

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
