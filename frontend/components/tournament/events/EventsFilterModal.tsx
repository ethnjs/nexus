"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterSectionProps {
  title: string;
  options: FilterOption[];
  /** Values excluded from the result set — empty means "everything shown". */
  excluded: Set<string>;
  onChange: (excluded: Set<string>) => void;
}

function FilterSection({ title, options, excluded, onChange }: FilterSectionProps) {
  function toggle(value: string) {
    const next = new Set(excluded);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next);
  }

  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        }}>
          {title}
        </span>
        <div style={{ display: "flex", gap: "4px" }}>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set())}>
            Select all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set(options.map((o) => o.value)))}>
            Deselect all
          </Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {options.map((opt) => (
          <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <Checkbox checked={!excluded.has(opt.value)} onChange={() => toggle(opt.value)} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
              {opt.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Values excluded per field — empty means that field applies no filtering,
// which keeps newly-appearing options (e.g. a category from a just-loaded
// event) shown by default instead of needing to be synced into an
// "everything selected" baseline.
export interface EventsFilterState {
  division: Set<string>;
  type: Set<string>;
  category: Set<string>;
}

export function isEventsFilterActive(filters: EventsFilterState): boolean {
  return filters.division.size > 0 || filters.type.size > 0 || filters.category.size > 0;
}

interface EventsFilterModalProps {
  divisionOptions: FilterOption[];
  typeOptions: FilterOption[];
  categoryOptions: FilterOption[];
  filters: EventsFilterState;
  onChange: (filters: EventsFilterState) => void;
  onClose: () => void;
}

export function EventsFilterModal({ divisionOptions, typeOptions, categoryOptions, filters, onChange, onClose }: EventsFilterModalProps) {
  return (
    <Modal title="Filter events" onClose={onClose} width={380}>
      <FilterSection
        title="Division"
        options={divisionOptions}
        excluded={filters.division}
        onChange={(division) => onChange({ ...filters, division })}
      />
      <FilterSection
        title="Type"
        options={typeOptions}
        excluded={filters.type}
        onChange={(type) => onChange({ ...filters, type })}
      />
      <FilterSection
        title="Category"
        options={categoryOptions}
        excluded={filters.category}
        onChange={(category) => onChange({ ...filters, category })}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
        <Button type="button" variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
