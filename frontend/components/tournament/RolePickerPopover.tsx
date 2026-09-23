"use client";

import type { ReactNode } from "react";
import type { Role } from "@/lib/api";
import { Popover } from "@/components/ui/Popover";
import { SEARCHABLE_ABOVE } from "@/components/ui/FilterModal";

/**
 * The tournament's roles as a checklist, with the ones already held ticked and
 * rank-locked ones showing a lock in place of the checkbox.
 *
 * One component so the roster chip's "+" and the mass editor's Add/Remove
 * buttons open the same list — they pick from the same catalog under the same
 * rank rule, and only what "ticked" means differs.
 */
export function RolePickerPopover({
  trigger, roles, isSelected, isDisabled, disabledReason, onSelect, emptyMessage,
}: {
  trigger: ReactNode;
  roles: Role[];
  isSelected: (role: Role) => boolean;
  isDisabled?: (role: Role) => boolean;
  disabledReason?: (role: Role) => string | undefined;
  onSelect: (role: Role) => void | Promise<void>;
  emptyMessage: string;
}) {
  return (
    <Popover
      trigger={trigger}
      items={roles}
      getKey={(role) => role.id}
      renderLabel={(role) => role.label}
      getSearchText={(role) => role.label}
      searchable={roles.length > SEARCHABLE_ABOVE}
      checklist
      isSelected={isSelected}
      isDisabled={isDisabled}
      disabledReason={disabledReason}
      onSelect={onSelect}
      emptyMessage={emptyMessage}
      width={220}
      align="left"
    />
  );
}
