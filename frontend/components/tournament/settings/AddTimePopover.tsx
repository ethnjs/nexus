"use client";

import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { IconPlus } from "@/components/ui/Icons";
import { invitesApi, Invite } from "@/lib/api";
import { HOUR_PRESETS } from "@/lib/invitePresets";

interface AddTimePopoverProps {
  tournamentId: number;
  invite: Invite;
  onUpdated: (invite: Invite) => void;
}

export function AddTimePopover({ tournamentId, invite, onUpdated }: AddTimePopoverProps) {
  return (
    <Popover
      trigger={
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Add time"
          style={{ width: "28px", height: "28px", padding: 0 }}
        >
          <IconPlus size={14} />
        </Button>
      }
      items={HOUR_PRESETS}
      getKey={(preset) => preset.value}
      renderLabel={(preset) => `+ ${preset.label}`}
      onSelect={async (preset) => {
        const updated = await invitesApi.update(tournamentId, invite.id, { add_hours: preset.hours });
        onUpdated(updated);
      }}
    />
  );
}
