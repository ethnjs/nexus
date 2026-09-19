"use client";

import { ReactNode, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { CheckboxList } from "@/components/ui/CheckboxList";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconPlus } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";

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

interface SectionBase<K extends string> {
  /** Field this section edits — must be a key of the filter state. */
  key: K;
  title: string;
  /** Drop the section entirely — heading included — for one with nothing to
   *  offer this tournament (no age collected, no lunch questions). */
  hidden?: boolean;
}

/** A section over a flat list of values, rendered by one of the stock controls. */
interface ListSection<K extends string> extends SectionBase<K> {
  options: FilterOption[];
  /** "buttons" for a handful of fixed values, "checkbox" for open-ended
   *  lists, "chips" for a long list where only the picked few are worth the
   *  space (see ChipFilterBody). */
  control: "buttons" | "checkbox" | "chips";
  /** Chips only. Defaults to "once the list is long enough to be worth
   *  typing at"; force it on for a list that is long *in practice*. */
  searchable?: boolean;
}

/**
 * A section whose control the caller draws — for a filter the stock controls
 * can't express, like the roster's paired "track × status" chips. The modal
 * still owns everything around it: the heading, its Clear, the draft, Apply.
 * That shared frame is the point — one heading implementation rather than one
 * per modal.
 */
interface CustomSection<K extends string> extends SectionBase<K> {
  control: "custom";
  render: (selected: Set<string>, onChange: (next: Set<string>) => void) => ReactNode;
}

export type FilterSectionConfig<K extends string> = ListSection<K> | CustomSection<K>;

interface FilterBodyProps {
  options: FilterOption[];
  /** Values the result set is narrowed to — empty means "everything shown". */
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  searchable?: boolean;
  title: string;
}

/**
 * A section's frame: its heading, its Clear, and the control beneath.
 *
 * Only "Clear", and only while there's something to clear. "Select all" was
 * the old model's counterpart to "Deselect all"; under empty-means-all it
 * would write out every option to mean exactly what an empty set already
 * means, and would then quietly exclude any option added afterwards.
 */
function FilterSection({ title, active, onClear, children }: {
  title: string;
  active: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        }}>
          {title}
        </span>
        {/* Always rendered, hidden when there's nothing to clear: the button
            is taller than the title beside it, so mounting it on the first
            selection grew the header and shifted every section below. Hidden
            rather than just invisible — out of the tab order and inert too. */}
        <Button
          type="button" variant="ghost" size="sm"
          onClick={onClear}
          disabled={!active}
          aria-hidden={!active}
          tabIndex={active ? undefined : -1}
          style={{ visibility: active ? "visible" : "hidden" }}
        >
          Clear
        </Button>
      </div>
      {children}
    </div>
  );
}

function toggled(selected: Set<string>, value: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(value)) next.add(value);
  return next;
}

function CheckboxFilterBody({ options, selected, onChange }: FilterBodyProps) {
  return (
    <CheckboxList
      options={options}
      value={[...selected]}
      onChange={(value) => onChange(toggled(selected, value))}
    />
  );
}

function ButtonGroupFilterBody({ options, selected, onChange }: FilterBodyProps) {
  return (
    <ButtonGroup
      options={options}
      value={[...selected]}
      onChange={(value) => onChange(toggled(selected, value))}
    />
  );
}

// Above this many rows a picker is faster to type into than to scroll.
export const SEARCHABLE_ABOVE = 8;

/**
 * Chips plus a checklist picker, for a section whose options are too many for
 * a button row to hold without wrapping into a wall — tracks, roles. Only the
 * picked values take space, so the section stays one line tall until it's
 * actually used.
 */
function ChipFilterBody({ title, options, selected, onChange, searchable }: FilterBodyProps) {
  const labelFor = new Map(options.map((o) => [o.value, o.label]));
  return (
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
          searchable={searchable ?? options.length > SEARCHABLE_ABOVE}
          checklist
          isSelected={(option) => selected.has(option.value)}
          onSelect={(option) => onChange(toggled(selected, option.value))}
          emptyMessage="Nothing to filter by"
          width={300}
          align="left"
        />
      }
    />
  );
}

const LIST_BODIES = {
  buttons: ButtonGroupFilterBody,
  checkbox: CheckboxFilterBody,
  chips: ChipFilterBody,
} as const;

function isHidden<K extends string>(section: FilterSectionConfig<K>): boolean {
  if (section.hidden) return true;
  // A chip section with nothing to pick has no control worth showing — a
  // lone "+" that opens an empty list. Buttons and checkboxes with no
  // options just render nothing, so they are the caller's to hide.
  return section.control === "chips" && section.options.length === 0;
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
  /** Options still loading — shows a spinner in place of the sections. */
  loading?: boolean;
  width?: number;
}

// Apply-gated: edits land in a local draft and the caller's state only moves
// on Apply. Callers mount this conditionally (`{open && <FilterModal .../>}`),
// so the draft is re-seeded from the applied filters on every open rather than
// resuming a stale one.
export function FilterModal<K extends string>({
  title, sections, filters, onApply, onClose, loading = false, width = 380,
}: FilterModalProps<K>) {
  const [draft, setDraft] = useState<FilterState<K>>(filters);

  function setField(key: K, selected: Set<string>) {
    setDraft((prev) => ({ ...prev, [key]: selected }));
  }

  // Every section's key, not just the draft's: a key the caller's state
  // predates is still one this modal shows, and so one Clear all must clear.
  function clearAll() {
    setDraft((prev) => {
      const next = { ...prev };
      for (const section of sections) next[section.key] = new Set<string>();
      return next;
    });
  }

  return (
    <Modal title={title} onClose={onClose} width={width}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : (
        // Fills the viewport minus the title and footer, so it only scrolls
        // on a short window or a long filter list.
        <div style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", paddingRight: "4px" }}>
          {sections.filter((section) => !isHidden(section)).map((section) => {
            // Falls back rather than indexing blind: the sections are the
            // caller's, so a key its filter state doesn't carry yet — one
            // added after a stored config was written — would otherwise
            // reach the control as undefined and crash on `.size`.
            const selected = draft[section.key] ?? new Set<string>();
            const onChange = (next: Set<string>) => setField(section.key, next);
            let control: ReactNode;
            if (section.control === "custom") {
              control = section.render(selected, onChange);
            } else {
              const Body = LIST_BODIES[section.control];
              control = (
                <Body
                  title={section.title}
                  options={section.options}
                  selected={selected}
                  onChange={onChange}
                  searchable={section.searchable}
                />
              );
            }
            return (
              <FilterSection
                key={section.key}
                title={section.title}
                active={selected.size > 0}
                onClear={() => onChange(new Set())}
              >
                {control}
              </FilterSection>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "4px" }}>
        <Button type="button" variant="ghost" onClick={clearAll}>Clear all</Button>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { onApply(draft); onClose(); }}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}
