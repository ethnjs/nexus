"use client";

import {
  FilterModal, FilterOption, FilterSectionConfig, FilterState, isFilterActive,
} from "@/components/ui/FilterModal";

export const MEMBERS_FILTER_KEYS = ["role", "status"] as const;
type MembersFilterKey = (typeof MEMBERS_FILTER_KEYS)[number];

export type MembersFilterState = FilterState<MembersFilterKey>;

export function isMembersFilterActive(filters: MembersFilterState): boolean {
  return isFilterActive(filters);
}

interface MembersFilterModalProps {
  roleOptions: FilterOption[];
  statusOptions: FilterOption[];
  filters: MembersFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: MembersFilterState) => void;
  onClose: () => void;
}

// Roles are open-ended (one per tournament role, plus "No roles"), so they get
// the checkbox list; status has two fixed values, so it gets the button group
// — same split Events uses for Category vs. Division/Type.
export function MembersFilterModal({ roleOptions, statusOptions, filters, onApply, onClose }: MembersFilterModalProps) {
  const sections: FilterSectionConfig<MembersFilterKey>[] = [
    { key: "status", title: "Status", options: statusOptions, control: "buttons" },
    { key: "role", title: "Roles", options: roleOptions, control: "checkbox" },
  ];

  return (
    <FilterModal
      title="Filter members"
      sections={sections}
      filters={filters}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
