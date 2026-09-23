"use client";

import { ReactNode, useEffect, useState } from "react";
import { FilterOptionGroup, FilterOptionItem, MemberFilterOptions, membersApi } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { PillMenu, PillTone } from "@/components/ui/PillMenu";
import { IconPlus } from "@/components/ui/Icons";
import {
  FilterModal, FilterSectionConfig, FilterState, SEARCHABLE_ABOVE, emptyFilterState,
} from "@/components/ui/FilterModal";

// One key per query param the roster accepts — the names are the params.
export const MEMBERS_FILTER_KEYS = [
  "role", "track", "lunch", "event_pref",
  "competition_event", "volunteer_event", "age", "shift", "assigned",
] as const;
type MembersFilterKey = (typeof MEMBERS_FILTER_KEYS)[number];

// The shared filter model — empty means "no narrowing" — under the roster's
// own keys. Use emptyFilterState(MEMBERS_FILTER_KEYS) and isFilterActive from
// FilterModal; this module no longer keeps copies of them.
export type MembersFilterState = FilterState<MembersFilterKey>;

// Filters whose values are "{group}:{option}" pairs. A stored value without
// the pair is from an older release (availability used to persist bare shift
// ids) — the server ignores it, so the modal has to as well, or a chip would
// sit there claiming to narrow a roster it isn't touching.
const PAIRED_KEYS: readonly MembersFilterKey[] = ["role", "track", "lunch", "event_pref", "shift", "assigned"];

function usableValues(key: string, values: Set<string>): string[] {
  const list = [...values];
  if (!PAIRED_KEYS.includes(key as MembersFilterKey)) return list;
  // "none" is the roles filter's own sentinel ("holds no roles"), not a pair.
  return list.filter((v) => v.includes(":") || (key === "role" && v === "none"));
}

/** The saved wire shape (arrays, keyed by filter) back into filter state.
    Unknown keys are dropped and unknown value shapes ignored — a filter
    removed in a later release must not come back as a chip that narrows
    nothing. */
export function membersFilterFromStored(
  stored: Record<string, string[]> | null | undefined,
): MembersFilterState {
  const state = emptyFilterState(MEMBERS_FILTER_KEYS);
  for (const key of MEMBERS_FILTER_KEYS) {
    const values = stored?.[key];
    if (Array.isArray(values)) {
      const strings = values.filter((v): v is string => typeof v === "string");
      // A role id saved before roles could be narrowed to tracks means "any
      // track", which is what an unnarrowed chip already is.
      state[key] = new Set(key === "role"
        ? strings.map((v) => (v.includes(":") || v === "none" ? v : `${v}:${ANY}`))
        : strings);
    }
  }
  return state;
}

/** The committed filters as the stored wire shape, empty keys dropped.
 *  Unpaired values are kept as saved; they are ignored on read. */
export function membersFilterToStored(filters: MembersFilterState): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, values]): [string, string[]] => [key, [...values]])
      .filter(([, values]) => values.length > 0),
  );
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

// Only worth colouring when the pill names one status — a pill reading
// "2 selected" has no single colour to be.
const TRACK_STATUS_TONES: Record<string, PillTone> = { confirmed: "success", declined: "danger" };

// Per track, like track status: "who's unassigned for Day 1".
const ASSIGNMENT_STATUS_OPTIONS: FilterOptionItem[] = [
  { value: "assigned", label: "Assigned" },
  { value: "unassigned", label: "Unassigned" },
];

interface MembersFilterModalProps {
  tournamentId: number;
  /** From the page, which already holds the tournament's role list. */
  roleOptions: FilterOptionItem[];
  filters: MembersFilterState;
  /** Pre-resolved options, for a caller that already holds them or isn't
      backed by a real tournament (the assignments sketch). Given, the modal
      skips its own fetch — so it never sits on a spinner waiting for a
      request that will not answer. */
  options?: MemberFilterOptions;
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

// ─── Paired chips ─────────────────────────────────────────────────────────

// A two-step filter: add the group first (a track, a lunch category,
// an event-preference question), then narrow it from the chip's own pill.
// The pairing is the point — filtering by track and by status separately
// would match a member confirmed on one track and declined on another, which
// is the opposite of what was asked — but asking for the pair up front means
// a picker holding every combination (tracks x 3, or every shift of every
// day), which is exactly the list nobody can read.
//
// Only the control — FilterModal draws the heading and Clear around it, the
// same frame every other section gets.
function PairedChipBody({ groups, selected, onChange, anyLabel, addLabel, emptyMessage, searchable, optionTones, answeredToggle }: {
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
    // unticking the last shift means "any shift on that track", not
    // "never mind".
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
            label={summaryFor(group)}
            tone={toneFor(group)}
            items={group.options}
            getKey={(option) => option.value}
            renderLabel={(option) => option.label}
            getSearchText={(option) => option.label}
            searchable={searchable ?? group.options.length > SEARCHABLE_ABOVE}
            checklist
            isSelected={(option) => chosenFor(group).includes(option.value)}
            onSelect={(option) => toggleOption(group, option.value)}
            header={answeredToggle ? answeredHeader(group) : undefined}
            emptyMessage="Nothing to filter by"
            width={260}
            align="left"
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
  );
}

export function MembersFilterModal({
  tournamentId, roleOptions, filters, options: suppliedOptions, onApply, onClose,
}: MembersFilterModalProps) {
  const [fetched, setFetched] = useState<MemberFilterOptions | null>(null);
  const options = suppliedOptions ?? fetched;

  useEffect(() => {
    if (suppliedOptions) return;
    membersApi.filterOptions(tournamentId).then(setFetched).catch(() => setFetched(null));
  }, [tournamentId, suppliedOptions]);

  // Seeded from the full key set and then overlaid, rather than handed over
  // as-is: a caller whose state predates a newly-added filter — a config
  // saved before it existed, a hand-built one (the assignments sketch), a
  // Fast Refresh keeping the page's state across the edit adding it — would
  // otherwise Apply a draft still missing that key.
  const [seeded] = useState<MembersFilterState>(() => {
    const full = emptyFilterState(MEMBERS_FILTER_KEYS);
    for (const key of MEMBERS_FILTER_KEYS) {
      const values = filters[key];
      if (values) full[key] = new Set(values);
    }
    return full;
  });

  const simpleTournament = (options?.tracks ?? []).length <= 1;
  const roleGroups: FilterOptionGroup[] = roleOptions.map((role) => ({
    ...role, options: options?.tracks ?? [],
  }));

  // Statuses are the same three for every track, so the groups are built
  // here rather than repeated in the options payload.
  const trackGroups: FilterOptionGroup[] = (options?.tracks ?? []).map((track) => ({
    ...track, options: TRACK_STATUS_OPTIONS,
  }));

  const assignmentGroups: FilterOptionGroup[] = (options?.tracks ?? []).map((track) => ({
    ...track, options: ASSIGNMENT_STATUS_OPTIONS,
  }));

  const ageOptions: FilterOptionItem[] = [
    ...(options?.collect_is_over_18 ? [{ value: "over_18", label: "18+" }] : []),
    ...(options?.collect_is_over_21 ? [{ value: "over_21", label: "21+" }] : []),
  ];

  /** A paired section — hidden when the tournament has no groups to offer. */
  function paired(
    key: MembersFilterKey, title: string, groups: FilterOptionGroup[],
    body: Omit<Parameters<typeof PairedChipBody>[0], "groups" | "selected" | "onChange">,
  ): FilterSectionConfig<MembersFilterKey> {
    return {
      key, title, control: "custom", hidden: groups.length === 0,
      render: (selected, onChange) => (
        <PairedChipBody groups={groups} selected={selected} onChange={onChange} {...body} />
      ),
    };
  }

  const sections: FilterSectionConfig<MembersFilterKey>[] = [
    // One track makes "on which track" a question with one answer, so a
    // simple tournament keeps the plain chips.
    simpleTournament
      ? { key: "role", title: "Roles", control: "chips", options: roleOptions }
      : paired("role", "Roles", roleGroups, {
          anyLabel: "Any track", addLabel: "Filter by role", emptyMessage: "No roles yet.",
        }),
    paired("assigned", "Assignments", assignmentGroups, {
      anyLabel: "Any", addLabel: "Filter by track", emptyMessage: "No active tracks.",
    }),
    paired("track", "Track status", trackGroups, {
      optionTones: TRACK_STATUS_TONES, anyLabel: "Any status", addLabel: "Filter by track",
      emptyMessage: "No active tracks.",
    }),
    // Two options at most, both fixed — a chip row with an add popover is
    // more machinery than picking between 18+ and 21+ deserves.
    { key: "age", title: "Age", control: "buttons", options: ageOptions, hidden: ageOptions.length === 0 },
    paired("shift", "Availability", options?.shift_days ?? [], {
      anyLabel: "Any shift", addLabel: "Filter by track",
      emptyMessage: "No shifts on this tournament yet.",
    }),
    paired("lunch", "Lunch", options?.lunch_categories ?? [], {
      answeredToggle: true, anyLabel: "Any answer", addLabel: "Filter by lunch question",
      emptyMessage: "No lunch questions on this tournament yet.",
    }),
    paired("event_pref", "Event preferences", options?.event_preferences ?? [], {
      searchable: true, anyLabel: "Any event", addLabel: "Filter by event preference",
      emptyMessage: "No event preference questions on this tournament yet.",
    }),
    {
      key: "competition_event", title: "Competition experience", control: "chips",
      options: options?.competition_events ?? [], searchable: true,
    },
    {
      key: "volunteer_event", title: "Volunteer experience", control: "chips",
      options: options?.volunteer_events ?? [], searchable: true,
    },
  ];

  return (
    <FilterModal
      title="Filter members"
      width={760}
      loading={options === null}
      sections={sections}
      filters={seeded}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
