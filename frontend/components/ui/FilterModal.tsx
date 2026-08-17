"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ButtonGroup } from "@/components/ui/ButtonGroup";

export interface FilterOption {
  value: string;
  label: string;
}

// Values excluded per field — empty means that field applies no filtering,
// which keeps newly-appearing options (e.g. a category from a just-loaded
// event) shown by default instead of needing to be synced into an
// "everything selected" baseline.
export type FilterState<K extends string> = Record<K, Set<string>>;

export function emptyFilterState<K extends string>(keys: readonly K[]): FilterState<K> {
  return Object.fromEntries(keys.map((k) => [k, new Set<string>()])) as FilterState<K>;
}

export function isFilterActive(filters: FilterState<string>): boolean {
  return Object.values(filters).some((excluded) => excluded.size > 0);
}

export interface FilterSectionConfig<K extends string> {
  /** Field this section edits — must be a key of the filter state. */
  key: K;
  title: string;
  options: FilterOption[];
  /** "buttons" for a handful of fixed values, "checkbox" for open-ended lists. */
  control: "buttons" | "checkbox";
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

export function CheckboxFilterSection({ title, options, excluded, onChange }: FilterSectionProps) {
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

export function ButtonGroupFilterSection({ title, options, excluded, onChange }: FilterSectionProps) {
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

interface FilterModalProps<K extends string> {
  title: string;
  sections: FilterSectionConfig<K>[];
  /** Currently-applied filters — seeds the draft when the modal mounts. */
  filters: FilterState<K>;
  /** Fired only on Apply; the modal closes itself afterwards. */
  onApply: (filters: FilterState<K>) => void;
  /** X / overlay / Escape / Cancel — the draft is thrown away. */
  onClose: () => void;
  width?: number;
}

// Apply-gated: edits land in a local draft and the caller's state only moves
// on Apply. Callers mount this conditionally (`{open && <FilterModal .../>}`),
// so the draft is re-seeded from the applied filters on every open rather than
// resuming a stale one.
export function FilterModal<K extends string>({ title, sections, filters, onApply, onClose, width = 380 }: FilterModalProps<K>) {
  const [draft, setDraft] = useState<FilterState<K>>(filters);

  function setField(key: K, excluded: Set<string>) {
    setDraft((prev) => ({ ...prev, [key]: excluded }));
  }

  return (
    <Modal title={title} onClose={onClose} width={width}>
      {sections.map((section) => {
        const Section = section.control === "checkbox" ? CheckboxFilterSection : ButtonGroupFilterSection;
        return (
          <Section
            key={section.key}
            title={section.title}
            options={section.options}
            excluded={draft[section.key]}
            onChange={(excluded) => setField(section.key, excluded)}
          />
        );
      })}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => { onApply(draft); onClose(); }}>Apply</Button>
      </div>
    </Modal>
  );
}
