"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ButtonGroup } from "@/components/ui/ButtonGroup";

export interface FilterOption {
  value: string;
  label: string;
}

interface SectionHeaderProps {
  title: string;
  options: FilterOption[];
  excluded: Set<string>;
  onChange: (excluded: Set<string>) => void;
}

// Just one toggle button, not both at once: "Deselect all" only makes sense
// while something is still selected, and vice versa.
function SectionHeader({ title, options, excluded, onChange }: SectionHeaderProps) {
  const allSelected = excluded.size === 0;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
      }}>
        {title}
      </span>
      {allSelected ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set(options.map((o) => o.value)))}>
          Deselect all
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set())}>
          Select all
        </Button>
      )}
    </div>
  );
}

interface FilterSectionProps {
  title: string;
  options: FilterOption[];
  /** Values excluded from the result set — empty means "everything shown". */
  excluded: Set<string>;
  onChange: (excluded: Set<string>) => void;
}

function CheckboxFilterSection({ title, options, excluded, onChange }: FilterSectionProps) {
  function toggle(value: string) {
    const next = new Set(excluded);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next);
  }

  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeader title={title} options={options} excluded={excluded} onChange={onChange} />
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

function ButtonGroupFilterSection({ title, options, excluded, onChange }: FilterSectionProps) {
  function toggle(value: string) {
    const next = new Set(excluded);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next);
  }

  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeader title={title} options={options} excluded={excluded} onChange={onChange} />
      <ButtonGroup
        options={options}
        value={options.filter((o) => !excluded.has(o.value)).map((o) => o.value)}
        onChange={toggle}
      />
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
      <ButtonGroupFilterSection
        title="Division"
        options={divisionOptions}
        excluded={filters.division}
        onChange={(division) => onChange({ ...filters, division })}
      />
      <ButtonGroupFilterSection
        title="Type"
        options={typeOptions}
        excluded={filters.type}
        onChange={(type) => onChange({ ...filters, type })}
      />
      <CheckboxFilterSection
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
