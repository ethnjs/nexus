"use client";

import { Popover, PopoverProps } from "@/components/ui/Popover";

export type ChecklistPopoverProps<T> =
  Omit<PopoverProps<T>, "checklist" | "onSelect" | "isSelected"> & {
    /** Required here, unlike on Popover: a checklist row with no checked
     *  state is a list, not a checklist. */
    isSelected: (item: T) => boolean;
    /** May throw/reject — the panel shows the error inline and stays open.
     *  Called with the clicked item; the add/remove is the caller's, same
     *  contract as ButtonGroup's multi-select mode. */
    onToggle: (item: T) => void | Promise<void>;
  };

/**
 * A multi-select panel: Popover with checklist mode baked in.
 *
 * Exists so a checklist is one component rather than a Popover plus a
 * remembered `checklist` flag, and so a new feature reaches for this instead
 * of hand-rolling checkbox rows — which is how the fractional row heights
 * that shifted the tick got in. Rows come from CheckboxRow either way.
 */
export function ChecklistPopover<T>({ isSelected, onToggle, ...rest }: ChecklistPopoverProps<T>) {
  return <Popover {...rest} checklist isSelected={isSelected} onSelect={onToggle} />;
}
