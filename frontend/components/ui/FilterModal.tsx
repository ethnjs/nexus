"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Checkbox } from "@/components/ui/Checkbox";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconPlus } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";

export interface FilterOption {
  value: string;
  label: string;
}

// Values *selected* per field — empty means that field applies no filtering,
// so a fresh modal opens with nothing lit rather than with every option lit
// and no filter actually applied, which read as a filter that wasn't one.
//
// Storing what's excluded instead makes "no filter" and "everything ticked"
// two different states that look identical, and needs an "everything
// selected" baseline kept in sync as options appear. Empty-means-all keeps a
// newly-appearing option (a category from a just-loaded event) shown by
// default under either model; this one just says so honestly.
export type FilterState<K extends string> = Record<K, Set<string>>;

export function emptyFilterState<K extends string>(keys: readonly K[]): FilterState<K> {
  return Object.fromEntries(keys.map((k) => [k, new Set<string>()])) as FilterState<K>;
}

export function isFilterActive(filters: FilterState<string>): boolean {
  return Object.values(filters).some((selected) => selected.size > 0);
}

/** Whether `value` passes one field's filter. Empty selection = no narrowing,
 *  which is the rule every caller's predicate needs and none should re-derive. */
export function filterAllows(selected: Set<string>, value: string): boolean {
  return selected.size === 0 || selected.has(value);
}

export interface FilterSectionConfig<K extends string> {
  /** Field this section edits — must be a key of the filter state. */
  key: K;
  title: string;
  options: FilterOption[];
  /** "buttons" for a handful of fixed values, "checkbox" for open-ended
   *  lists, "chips" for a long list where only the picked few are worth the
   *  space (see ChipFilterSection). */
  control: "buttons" | "checkbox" | "chips";
}

interface FilterSectionProps {
  title: string;
  options: FilterOption[];
  /** Values the result set is narrowed to — empty means "everything shown". */
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

// Only "Clear", and only while there's something to clear. "Select all" was
// the old model's counterpart to "Deselect all"; under empty-means-all it
// would write out every option to mean exactly what an empty set already
// means, and would then quietly exclude any option added afterwards.
function SectionHeader({ title, selected, onChange }: Omit<FilterSectionProps, "options">) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
      }}>
        {title}
      </span>
      {selected.size > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set())}>
          Clear
        </Button>
      )}
    </div>
  );
}

function toggled(selected: Set<string>, value: string): Set<string> {
  const next = new Set(selected);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

export function CheckboxFilterSection({ title, options, selected, onChange }: FilterSectionProps) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeader title={title} selected={selected} onChange={onChange} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {options.map((opt) => (
          <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <Checkbox checked={selected.has(opt.value)} onChange={() => onChange(toggled(selected, opt.value))} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
              {opt.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ButtonGroupFilterSection({ title, options, selected, onChange }: FilterSectionProps) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeader title={title} selected={selected} onChange={onChange} />
      <ButtonGroup
        options={options}
        value={[...selected]}
        onChange={(value) => onChange(toggled(selected, value))}
      />
    </div>
  );
}

// Above this many rows a picker is faster to type into than to scroll.
const SEARCHABLE_ABOVE = 8;

/**
 * Chips plus a checklist picker, for a section whose options are too many for
 * a button row to hold without wrapping into a wall — tracks, roles. Only the
 * picked values take space, so the section stays one line tall until it's
 * actually used.
 */
export function ChipFilterSection({ title, options, selected, onChange }: FilterSectionProps) {
  if (options.length === 0) return null;
  const labelFor = new Map(options.map((o) => [o.value, o.label]));

  return (
    <div style={{ marginBottom: "20px" }}>
      <SectionHeader title={title} selected={selected} onChange={onChange} />
      <ChipInput
        // Chips carry labels while the state carries values, so a removed
        // chip is matched back by label rather than parsed out of its text.
        value={[...selected].map((value) => labelFor.get(value) ?? value)}
        onChange={(labels) => {
          const removed = [...selected].find((value) => !labels.includes(labelFor.get(value) ?? value));
          if (removed) onChange(toggled(selected, removed));
        }}
        variant="transparent"
        size="sm"
        disableInput
        fullWidth
        placeholder="Any"
        addButton={
          <Popover
            trigger={
              <Button
                type="button" variant="secondary" size="sm" iconOnly
                title={`Filter by ${title.toLowerCase()}`}
                style={{ padding: 0, flexShrink: 0 }}
              >
                <IconPlus size={13} />
              </Button>
            }
            items={options}
            getKey={(option) => option.value}
            renderLabel={(option) => option.label}
            getSearchText={(option) => option.label}
            searchable={options.length > SEARCHABLE_ABOVE}
            checklist
            isSelected={(option) => selected.has(option.value)}
            onSelect={(option) => onChange(toggled(selected, option.value))}
            emptyMessage="Nothing to filter by"
            width={300}
            align="left"
          />
        }
      />
    </div>
  );
}

const SECTION_CONTROLS = {
  buttons: ButtonGroupFilterSection,
  checkbox: CheckboxFilterSection,
  chips: ChipFilterSection,
} as const;

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

  function setField(key: K, selected: Set<string>) {
    setDraft((prev) => ({ ...prev, [key]: selected }));
  }

  return (
    <Modal title={title} onClose={onClose} width={width}>
      {sections.map((section) => {
        const Section = SECTION_CONTROLS[section.control];
        // Falls back rather than indexing blind: the sections are the
        // caller's, so a key its filter state doesn't carry yet — one added
        // after a stored config was written — would otherwise reach the
        // section as undefined and crash on `.size`.
        const selected = draft[section.key] ?? new Set<string>();
        return (
          <Section
            key={section.key}
            title={section.title}
            options={section.options}
            selected={selected}
            onChange={(next) => setField(section.key, next)}
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
