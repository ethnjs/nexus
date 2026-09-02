"use client";

import { ReactNode, useEffect, useState } from "react";
import { FilterOptionGroup, FilterOptionItem, MemberFilterOptions, membershipsApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { IconChevronDown, IconPlus } from "@/components/ui/Icons";

// One key per query param the roster accepts — the names are the params.
export const MEMBERS_FILTER_KEYS = [
  "role", "track", "lunch", "event_pref",
  "competition_event", "volunteer_event", "age", "shift",
] as const;
type MembersFilterKey = (typeof MEMBERS_FILTER_KEYS)[number];

export type MembersFilterState = Record<MembersFilterKey, Set<string>>;

export function emptyMembersFilter(): MembersFilterState {
  return Object.fromEntries(MEMBERS_FILTER_KEYS.map((k) => [k, new Set<string>()])) as MembersFilterState;
}

export function isMembersFilterActive(filters: MembersFilterState): boolean {
  return Object.values(filters).some((values) => values.size > 0);
}

// Filters whose values are "{group}:{option}" pairs. A stored value without
// the pair is from an older release (availability used to persist bare shift
// ids) — the server ignores it, so the modal has to as well, or a chip would
// sit there claiming to narrow a roster it isn't touching.
const PAIRED_KEYS: readonly MembersFilterKey[] = ["track", "lunch", "event_pref", "shift"];

function usableValues(key: string, values: Set<string>): string[] {
  const list = [...values];
  return PAIRED_KEYS.includes(key as MembersFilterKey) ? list.filter((v) => v.includes(":")) : list;
}

/** The committed filters as repeatable query params, empty keys dropped. */
export function membersFilterParams(filters: MembersFilterState): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, values]) => [key, usableValues(key, values)] as const)
      .filter(([, values]) => values.length > 0),
  );
}

// Right-hand sentinel shared with the backend (see member_filters.ANY): a
// group added as a chip but not yet narrowed. Every paired filter starts
// here — "this track, any status" is a useful filter on its own, so a fresh
// chip means something before its pill is ever opened.
const ANY = "__any__";

// Lunch-only, and shared with the backend the same way: "answered nothing at
// all". Its counterpart is ANY — "answered something" — so the two are the
// pill's answered/not-answered toggle rather than two more rows in its list.
const UNANSWERED = "__unanswered__";
const ANSWERED_OPTIONS = [{ value: ANY, label: "Answered" }, { value: UNANSWERED, label: "Not answered" }];

// Fixed, unlike everything else in the modal, so they're spelled out rather
// than fetched. No "any" row: that's what an untouched chip already means,
// and a checkbox for it would sit alongside the three real statuses as a
// fourth thing to tick.
const TRACK_STATUS_OPTIONS: FilterOptionItem[] = [
  { value: "interested", label: "Interested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "declined", label: "Declined" },
];

// Same palette as Badge's confirmed/declined variants and the forms editor's
// track pill — only worth showing when the pill names one status, since a
// pill reading "2 selected" has no single color to be.
type PillTone = "default" | "success" | "danger";
const TRACK_STATUS_TONES: Record<string, PillTone> = { confirmed: "success", declined: "danger" };
const PILL_TONE_STYLE: Record<PillTone, { background: string; color: string; border: string }> = {
  default: { background: "transparent", color: "var(--color-text-secondary)", border: "var(--color-border-strong)" },
  success: { background: "var(--color-success-subtle)", color: "var(--color-success)", border: "var(--color-success)" },
  danger:  { background: "var(--color-danger-subtle)", color: "var(--color-danger)", border: "var(--color-danger)" },
};

// Above this many rows a picker is faster to type into than to scroll.
const SEARCHABLE_ABOVE = 8;

interface MembersFilterModalProps {
  tournamentId: number;
  /** From the page, which already holds the tournament's role list. */
  roleOptions: FilterOptionItem[];
  filters: MembersFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: MembersFilterState) => void;
  onClose: () => void;
}

// ─── Paired-value helpers ─────────────────────────────────────────────────
// A paired filter value is "{group}:{option}" — a track and a status, a day
// and a shift, a lunch category and an answer. partition on the *first*
// colon only: a lunch answer can contain one ("Sides: chips").

function splitPair(value: string): [string, string] {
  const at = value.indexOf(":");
  return at === -1 ? [value, ANY] : [value.slice(0, at), value.slice(at + 1)];
}

function optionsFor(selected: Set<string>, group: string): string[] {
  return [...selected]
    .filter((value) => value.includes(":") && splitPair(value)[0] === group)
    .map((value) => splitPair(value)[1]);
}

/** Replaces every value under `group` — an empty list drops its chip. */
function withGroup(selected: Set<string>, group: string, options: string[]): Set<string> {
  const next = new Set([...selected].filter((value) => splitPair(value)[0] !== group));
  for (const option of options) next.add(`${group}:${option}`);
  return next;
}

// ─── Section chrome ───────────────────────────────────────────────────────

function FilterSection({ title, active, onClear, children }: {
  title: string;
  active: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        }}>
          {title}
        </span>
        {/* Only while there's something to clear — a permanent dead button
            beside every heading reads as chrome, not as an action. */}
        {active && (
          <Button type="button" variant="ghost" size="xs" onClick={onClear} style={{ padding: "0 6px" }}>
            Clear
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

// The pill on a chip's right edge — a plain clickable pill + chevron rather
// than a bordered Dropdown, so it reads as part of the chip instead of a
// boxed control embedded in one (same reasoning as the forms editor's track
// status pill, and the same height).
function PillMenu({ summary, tone, options, isChecked, onSelect, searchable, header }: {
  summary: string;
  tone: PillTone;
  options: FilterOptionItem[];
  isChecked: (value: string) => boolean;
  onSelect: (value: string) => void;
  searchable: boolean;
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pill = PILL_TONE_STYLE[tone];
  return (
    <Popover
      trigger={
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "2px", boxSizing: "border-box",
          padding: "1px 6px", borderRadius: "999px",
          border: `1px solid ${pill.border}`, background: pill.background, color: pill.color,
          fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
          cursor: "pointer", whiteSpace: "nowrap",
        }}>
          {summary}
          <IconChevronDown size={9} style={{ transition: "transform 150ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
        </span>
      }
      items={options}
      getKey={(option) => option.value}
      renderLabel={(option) => option.label}
      getSearchText={(option) => option.label}
      searchable={searchable}
      checklist
      isSelected={(option) => isChecked(option.value)}
      onSelect={(option) => onSelect(option.value)}
      onOpenChange={setOpen}
      header={header}
      emptyMessage="Nothing to filter by"
      width={260}
      align="left"
    />
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────

// A flat list of values (roles, experience) — chips plus a checklist picker.
// Chips rather than a column of checkboxes: a tournament can offer a dozen
// roles and thirty experience events, and a checkbox list per section would
// be an unreadable modal. A chip row shows what's being filtered on, and
// nothing else.
function ChipFilter({ title, options, selected, onToggle, onClear, searchable }: {
  title: string;
  options: FilterOptionItem[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Defaults to "only once the list is long enough to be worth typing at". */
  searchable?: boolean;
}) {
  if (options.length === 0) return null;
  const labelFor = new Map(options.map((o) => [o.value, o.label]));

  return (
    <FilterSection title={title} active={selected.size > 0} onClear={onClear}>
      <ChipInput
        value={[...selected].map((value) => labelFor.get(value) ?? value)}
        onChange={(labels) => {
          const removed = [...selected].find((value) => !labels.includes(labelFor.get(value) ?? value));
          if (removed) onToggle(removed);
        }}
        variant="transparent"
        size="sm"
        disableInput
        fullWidth
        placeholder="Any"
        addButton={
          <Popover
            trigger={
              <Button type="button" variant="secondary" size="sm" iconOnly title={`Filter by ${title.toLowerCase()}`} style={{ padding: 0, flexShrink: 0 }}>
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
            onSelect={(option) => onToggle(option.value)}
            emptyMessage="Nothing to filter by"
            width={300}
            align="left"
          />
        }
      />
    </FilterSection>
  );
}

// A two-step filter: add the group first (a track, a day, a lunch category,
// an event-preference question), then narrow it from the chip's own pill.
// The pairing is the point — filtering by track and by status separately
// would match a member confirmed on one track and declined on another, which
// is the opposite of what was asked — but asking for the pair up front means
// a picker holding every combination (tracks x 3, or every shift of every
// day), which is exactly the list nobody can read.
function PairedChipFilter({ title, groups, selected, onChange, anyLabel, addLabel, emptyMessage, searchable, optionTones, answeredToggle }: {
  title: string;
  groups: FilterOptionGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Pill text for a chip that hasn't been narrowed — "Any shift", "Any answer". */
  anyLabel: string;
  addLabel: string;
  emptyMessage: string;
  /** Defaults to "only once a chip's option list is long enough to be worth typing at". */
  searchable?: boolean;
  /** Per-option pill color, applied only when a chip is narrowed to that one option. */
  optionTones?: Record<string, PillTone>;
  /** Lunch: offers answered/not-answered above the list. "Answered" ticks every box, "not answered" clears them — a free-text question has no boxes at all, and that is still the useful question to ask of it. */
  answeredToggle?: boolean;
}) {
  if (groups.length === 0) return null;

  // A group the options endpoint no longer offers (a deleted lunch question,
  // an archived track) still filters, so it keeps a chip under its raw key
  // rather than silently narrowing the roster from nowhere.
  const known = new Set(groups.map((group) => group.value));
  const orphans = [...new Set([...selected].filter((v) => v.includes(":")).map((value) => splitPair(value)[0]))]
    .filter((group) => !known.has(group))
    .map((group) => ({ value: group, label: group, options: [] as FilterOptionItem[] }));
  const chipped = [...groups, ...orphans].filter((group) => optionsFor(selected, group.value).length > 0);
  const groupByLabel = new Map(chipped.map((group) => [group.label, group]));
  // Already-chipped groups drop out of the picker: a second chip for the
  // same track would just overwrite the first one's status.
  const unchipped = groups.filter((group) => optionsFor(selected, group.value).length === 0);

  /** The options actually ticked — ANY reads as "all of them" under the toggle. */
  function chosenFor(group: FilterOptionGroup): string[] {
    const chosen = optionsFor(selected, group.value);
    if (answeredToggle && chosen.includes(ANY)) return group.options.map((option) => option.value);
    return chosen.filter((option) => option !== ANY && option !== UNANSWERED);
  }

  function summaryFor(group: FilterOptionGroup): string {
    const raw = optionsFor(selected, group.value);
    if (answeredToggle && raw.includes(ANY)) return "Answered";
    if (answeredToggle && raw.includes(UNANSWERED)) return "Not answered";
    const chosen = chosenFor(group);
    if (chosen.length === 0) return anyLabel;
    if (chosen.length === 1) {
      return group.options.find((option) => option.value === chosen[0])?.label ?? chosen[0];
    }
    return `${chosen.length} selected`;
  }

  function toneFor(group: FilterOptionGroup): PillTone {
    const chosen = chosenFor(group);
    return (chosen.length === 1 && optionTones?.[chosen[0]]) || "default";
  }

  function toggleOption(group: FilterOptionGroup, option: string) {
    const chosen = chosenFor(group);
    const next = chosen.includes(option) ? chosen.filter((value) => value !== option) : [...chosen, option];
    // Every box ticked is exactly "answered", so it collapses back to the
    // sentinel — otherwise an answer nobody listed as an option (an "other",
    // a free-text reply) would be dropped by a pill claiming to show all.
    if (answeredToggle && group.options.length > 0 && next.length === group.options.length) {
      onChange(withGroup(selected, group.value, [ANY]));
      return;
    }
    // Emptying a chip falls back to the sentinel rather than deleting it —
    // unticking the last shift means "any shift that day", not "never mind".
    onChange(withGroup(selected, group.value, next.length > 0 ? next : [ANY]));
  }

  function answeredHeader(group: FilterOptionGroup): ReactNode {
    const raw = optionsFor(selected, group.value);
    return (
      <ButtonGroup
        options={ANSWERED_OPTIONS}
        value={raw.includes(UNANSWERED) ? UNANSWERED : raw.includes(ANY) ? ANY : ""}
        onChange={(value) => onChange(withGroup(selected, group.value, [value]))}
        size="sm"
        fullWidth
      />
    );
  }

  return (
    <FilterSection title={title} active={selected.size > 0} onClear={() => onChange(new Set())}>
      <ChipInput
        value={chipped.map((group) => group.label)}
        onChange={(labels) => {
          const removed = chipped.find((group) => !labels.includes(group.label));
          if (removed) onChange(withGroup(selected, removed.value, []));
        }}
        variant="transparent"
        size="sm"
        disableInput
        fullWidth
        placeholder="Any"
        renderChipTrailing={(label) => {
          const group = groupByLabel.get(label);
          // A free-text lunch question has no options, but answered/not
          // answered is still worth asking — so the pill stays.
          if (!group || (group.options.length === 0 && !answeredToggle)) return null;
          return (
            <PillMenu
              summary={summaryFor(group)}
              tone={toneFor(group)}
              options={group.options}
              isChecked={(option) => chosenFor(group).includes(option)}
              onSelect={(option) => toggleOption(group, option)}
              header={answeredToggle ? answeredHeader(group) : undefined}
              searchable={searchable ?? group.options.length > SEARCHABLE_ABOVE}
            />
          );
        }}
        addButton={
          <Popover
            trigger={
              <Button type="button" variant="secondary" size="sm" iconOnly title={addLabel} style={{ padding: 0, flexShrink: 0 }}>
                <IconPlus size={13} />
              </Button>
            }
            items={unchipped}
            getKey={(group) => group.value}
            renderLabel={(group) => group.label}
            getSearchText={(group) => group.label}
            searchable={groups.length > SEARCHABLE_ABOVE}
            onSelect={(group) => onChange(withGroup(selected, group.value, [ANY]))}
            emptyMessage={groups.length > 0 && unchipped.length === 0 ? "All added" : emptyMessage}
            width={300}
            align="left"
          />
        }
      />
    </FilterSection>
  );
}

export function MembersFilterModal({
  tournamentId, roleOptions, filters, onApply, onClose,
}: MembersFilterModalProps) {
  const [options, setOptions] = useState<MemberFilterOptions | null>(null);
  // Draft until Apply, so closing with Cancel leaves the roster as it was.
  const [draft, setDraft] = useState<MembersFilterState>(
    () => Object.fromEntries(
      Object.entries(filters).map(([key, values]) => [key, new Set(values)]),
    ) as MembersFilterState,
  );

  useEffect(() => {
    membershipsApi.filterOptions(tournamentId).then(setOptions).catch(() => setOptions(null));
  }, [tournamentId]);

  function set(key: MembersFilterKey, values: Set<string>) {
    setDraft((prev) => ({ ...prev, [key]: values }));
  }

  function toggle(key: MembersFilterKey, value: string) {
    setDraft((prev) => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  }

  // Statuses are the same three for every track, so the groups are built
  // here rather than repeated in the options payload.
  const trackGroups: FilterOptionGroup[] = (options?.tracks ?? []).map((track) => ({
    ...track, options: TRACK_STATUS_OPTIONS,
  }));

  const ageOptions: FilterOptionItem[] = [
    ...(options?.collect_is_over_18 ? [{ value: "over_18", label: "18+" }] : []),
    ...(options?.collect_is_over_21 ? [{ value: "over_21", label: "21+" }] : []),
  ];

  return (
    <Modal title="Filter members" onClose={onClose} width={640}>
      {options === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
          <ChipFilter
            title="Roles" options={roleOptions} selected={draft.role}
            onToggle={(v) => toggle("role", v)} onClear={() => set("role", new Set())}
          />
          <PairedChipFilter
            title="Track status" groups={trackGroups} selected={draft.track}
            onChange={(next) => set("track", next)}
            optionTones={TRACK_STATUS_TONES} anyLabel="Any status" addLabel="Filter by track"
            emptyMessage="No active tracks."
          />
          {/* Two options at most, both fixed — a chip row with an add
              popover is more machinery than picking between 18+ and 21+
              deserves. */}
          {ageOptions.length > 0 && (
            <FilterSection title="Age" active={draft.age.size > 0} onClear={() => set("age", new Set())}>
              <ButtonGroup
                options={ageOptions.map((o) => ({ value: o.value, label: o.label }))}
                value={[...draft.age]}
                onChange={(value) => toggle("age", value)}
              />
            </FilterSection>
          )}
          <PairedChipFilter
            title="Availability" groups={options.shift_days} selected={draft.shift}
            onChange={(next) => set("shift", next)}
            anyLabel="Any shift" addLabel="Filter by day"
            emptyMessage="No shifts on this tournament yet."
          />
          <PairedChipFilter
            title="Lunch" groups={options.lunch_categories} selected={draft.lunch}
            onChange={(next) => set("lunch", next)}
            answeredToggle anyLabel="Any answer" addLabel="Filter by lunch question"
            emptyMessage="No lunch questions on this tournament yet."
          />
          <PairedChipFilter
            title="Event preferences" groups={options.event_preferences} selected={draft.event_pref}
            onChange={(next) => set("event_pref", next)}
            searchable anyLabel="Any event" addLabel="Filter by event preference"
            emptyMessage="No event preference questions on this tournament yet."
          />
          <ChipFilter
            title="Competition experience" searchable options={options.competition_events} selected={draft.competition_event}
            onToggle={(v) => toggle("competition_event", v)} onClear={() => set("competition_event", new Set())}
          />
          <ChipFilter
            title="Volunteer experience" searchable options={options.volunteer_events} selected={draft.volunteer_event}
            onToggle={(v) => toggle("volunteer_event", v)} onClear={() => set("volunteer_event", new Set())}
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "8px" }}>
        <Button type="button" variant="ghost" onClick={() => setDraft(emptyMembersFilter())}>
          Clear all
        </Button>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { onApply(draft); onClose(); }}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}
