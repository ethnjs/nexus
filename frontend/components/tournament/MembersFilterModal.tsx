"use client";

import {
  FilterModal, FilterOption, FilterSectionConfig, FilterState, isFilterActive,
} from "@/components/ui/FilterModal";

export const MEMBERS_FILTER_KEYS = ["role"] as const;
type MembersFilterKey = (typeof MEMBERS_FILTER_KEYS)[number];

export type MembersFilterState = FilterState<MembersFilterKey>;

export function isMembersFilterActive(filters: MembersFilterState): boolean {
  return isFilterActive(filters);
}

interface MembersFilterModalProps {
  roleOptions: FilterOption[];
  filters: MembersFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: MembersFilterState) => void;
  onClose: () => void;
}

// Roles are open-ended (one per tournament role, plus "No roles"), so they get
// the checkbox list rather than a button group.
export function MembersFilterModal({ roleOptions, filters, onApply, onClose }: MembersFilterModalProps) {
  const sections: FilterSectionConfig<MembersFilterKey>[] = [
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
