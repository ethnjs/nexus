"use client";

import { Dropdown, type DropdownOption } from "@/components/ui/Dropdown";
import type { FormFieldOption } from "@/lib/api";
import type { BranchTarget } from "@/lib/forms/branching";

const CONTINUE_VALUE = "__continue__";
const SUBMIT_VALUE = "__submit__";
const JUMP_PREFIX = "jump:";

// Falling through the last question ends the form, so it reads as Submit.
function branchValueFor(
  option: FormFieldOption,
  nextFieldId: string | null,
  isLast: boolean,
): string {
  if (option.action === "submit_form") return SUBMIT_VALUE;
  if (option.next_field_id != null && option.next_field_id !== nextFieldId)
    return `${JUMP_PREFIX}${option.next_field_id}`;
  return isLast ? SUBMIT_VALUE : CONTINUE_VALUE;
}

function applyBranchValue<T extends FormFieldOption>(option: T, value: string): T {
  if (value === SUBMIT_VALUE) return { ...option, action: "submit_form", next_field_id: null };
  if (value.startsWith(JUMP_PREFIX))
    return { ...option, action: null, next_field_id: value.slice(JUMP_PREFIX.length) };
  return { ...option, action: null, next_field_id: null };
}

// Inline, right-aligned in the option's own row (Google-Forms-style — a
// jump target reads as part of the option, not a separate settings block
// hanging underneath it), rather than a full-width Dropdown on its own line.
export function BranchDropdown<T extends FormFieldOption>({
  option,
  branchTargets,
  onChange,
}: {
  option: T;
  branchTargets: BranchTarget[];
  onChange: (option: T) => void;
}) {
  const isLast = branchTargets.every((t) => t.position === "above");
  const nextFieldId = branchTargets.find((t) => t.position === "next")?.id ?? null;
  const backwardTarget = branchTargets.find(
    (t) => t.position === "above" && t.id === option.next_field_id,
  );
  const branchOptions: DropdownOption[] = [
    ...(isLast ? [] : [{ value: CONTINUE_VALUE, label: "Continue to next question" }]),
    ...(backwardTarget
      ? [
          {
            value: `${JUMP_PREFIX}${backwardTarget.id}`,
            label: `Jump to: ${backwardTarget.label}`,
            disabled: true,
            subtitle: "Above this question",
          },
        ]
      : []),
    ...branchTargets
      .filter((t) => t.position === "below" && t.label)
      .map(
        (t): DropdownOption => ({
          value: t.id != null ? `${JUMP_PREFIX}${t.id}` : `${JUMP_PREFIX}unsaved:${t.label}`,
          label: `Jump to: ${t.label}`,
          disabled: t.id == null,
          subtitle: t.id == null ? "Save the form to enable this target" : undefined,
        }),
      ),
    { value: SUBMIT_VALUE, label: "Submit form" },
  ];

  return (
    <Dropdown
      value={branchValueFor(option, nextFieldId, isLast)}
      onChange={(value) => onChange(applyBranchValue(option, value))}
      options={branchOptions}
      error={backwardTarget ? "Pick a question below this one." : undefined}
      size="md"
      width={190}
      variant="primary"
    />
  );
}
