"use client";

import { useEffect, useState } from "react";
import { FilterOptionItem, MemberFilterOptions, membershipsApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { IconPlus } from "@/components/ui/Icons";

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

/** The committed filters as repeatable query params, empty keys dropped. */
export function membersFilterParams(filters: MembersFilterState): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, values]) => values.size > 0).map(([key, values]) => [key, [...values]]),
  );
}

// Statuses are fixed, unlike everything else here, so they're spelled out
// rather than fetched. Paired with a track id ("2:confirmed") because
// "declined" only means something about a particular track.
const TRACK_STATUSES = ["interested", "confirmed", "declined"] as const;

interface MembersFilterModalProps {
  tournamentId: number;
  /** From the page, which already holds the tournament's role list. */
  roleOptions: FilterOptionItem[];
  filters: MembersFilterState;
  /** Fires on Apply only — the modal closes itself afterwards. */
  onApply: (filters: MembersFilterState) => void;
  onClose: () => void;
}

// Chips rather than checkbox lists: a tournament can offer a dozen tracks,
// twenty event-preference pairs and thirty experience events, and a column of
// checkboxes for each would be an unreadable modal. A chip row shows what's
// being filtered on and nothing else.
function ChipFilter({ title, options, selected, onToggle }: {
  title: string;
  options: FilterOptionItem[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;
  const labelFor = new Map(options.map((o) => [o.value, o.label]));

  return (
    <div style={{ marginBottom: "16px" }}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        display: "block", marginBottom: "6px",
      }}>
        {title}
      </span>
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
            checklist
            isSelected={(option) => selected.has(option.value)}
            onSelect={(option) => onToggle(option.value)}
            emptyMessage="Nothing to filter by"
            width={300}
          />
        }
      />
    </div>
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

  function toggle(key: MembersFilterKey, value: string) {
    setDraft((prev) => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  }

  // A track filter is a (track, status) pair, so the picker offers every
  // combination rather than two lists that would have to be ANDed by guess.
  const trackOptions: FilterOptionItem[] = (options?.tracks ?? []).flatMap((track) =>
    TRACK_STATUSES.map((status) => ({
      value: `${track.value}:${status}`,
      label: `${track.label} — ${status}`,
    })),
  );

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
          <ChipFilter title="Roles" options={roleOptions} selected={draft.role} onToggle={(v) => toggle("role", v)} />
          <ChipFilter title="Track status" options={trackOptions} selected={draft.track} onToggle={(v) => toggle("track", v)} />
          <ChipFilter title="Age" options={ageOptions} selected={draft.age} onToggle={(v) => toggle("age", v)} />
          <ChipFilter title="Availability" options={options.shifts} selected={draft.shift} onToggle={(v) => toggle("shift", v)} />
          <ChipFilter title="Lunch" options={options.lunch} selected={draft.lunch} onToggle={(v) => toggle("lunch", v)} />
          <ChipFilter title="Event preferences" options={options.event_preferences} selected={draft.event_pref} onToggle={(v) => toggle("event_pref", v)} />
          <ChipFilter title="Competition experience" options={options.competition_events} selected={draft.competition_event} onToggle={(v) => toggle("competition_event", v)} />
          <ChipFilter title="Volunteer experience" options={options.volunteer_events} selected={draft.volunteer_event} onToggle={(v) => toggle("volunteer_event", v)} />
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
