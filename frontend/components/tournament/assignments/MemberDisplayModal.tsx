"use client";

/**
 * Which optional pieces of a member belt card show, and the modal that
 * configures it.
 *
 * Flat: every field is a checkbox, all of them visible at once. The member
 * panel's own display config nests fields under collapsible,
 * individually-hideable sections because it has forty of them; the card has
 * nine, and at that size the nesting is more chrome than the thing it
 * organises.
 *
 * So there is no section toggle either — an experience block shows when any
 * of its columns is checked. "Show the section but none of its fields" is a
 * state that renders as nothing, which is not worth a control of its own.
 *
 * Nothing here talks to an API itself: the board owns the state and persists
 * it through displayConfigApi under the `assignment_card` surface (see the
 * converters below). Either way the filtering happens at render time in the
 * card — the server's payload for this surface is a fixed field set.
 */
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconPlus } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { Switch } from "@/components/ui/Switch";

export type MemberFieldId =
  | "roles"
  | "age"
  | "onboarding"
  | "dietary_restriction"
  | "track_status"
  | "event_preferences"
  | "availability"
  | "lunch"
  | "custom_fields"
  | "competition_school"
  | "competition_event"
  | "volunteer_tournament"
  | "volunteer_event"
  | "volunteer_role";

/** The fields that are a per-track list, and so carry their own track chips.
 *  Scoped per field rather than shared: a TD may well want Day 1 preferences
 *  beside every track's availability. */
export const TRACK_SCOPED_FIELDS: { id: MemberFieldId; label: string }[] = [
  { id: "track_status", label: "Track status" },
  { id: "event_preferences", label: "Event preferences" },
  { id: "availability", label: "Availability" },
  { id: "lunch", label: "Lunch" },
];

/** The per-track fields a tab turns on for its own track by default — what a
 *  day is staffed from. Lunch is per track too, but background. */
const TAB_DEFAULT_FIELDS: MemberFieldId[] = ["track_status", "event_preferences", "availability"];

/**
 * Hidden-by-exception: anything not named in a `hidden*` array is shown, so a
 * field added later is visible without migrating saved state.
 */
export interface MemberDisplayState {
  hiddenFields: MemberFieldId[];
  /** "{fieldId}:{trackId}". */
  hiddenTracks: string[];
  /** Form field ids of custom questions hidden from the custom_fields field. */
  hiddenCustom: string[];
}

export const DEFAULT_MEMBER_DISPLAY: MemberDisplayState = {
  // A belt card is scanned at a glance mid-drag. Everything on turns it into
  // a wall, so the experience tables and availability start off — they answer
  // a question you ask about one person, not about the row you are staffing.
  hiddenFields: [
    "availability",
    "competition_school", "competition_event",
    "volunteer_tournament", "volunteer_event", "volunteer_role",
    // Off until asked for, same reasoning: background, not staffing.
    "onboarding", "dietary_restriction", "lunch", "custom_fields",
  ],
  hiddenTracks: [],
  hiddenCustom: [],
};

/**
 * The starting card for one tab, before anything is saved for it.
 *
 * All starts with every track: it is the tab for reading across the whole
 * tournament, so a card that hid days would be answering a narrower question
 * than the tab asks. A track tab starts with exactly its own. Either way the
 * three per-track fields are on — they are what a day is staffed from.
 */
export function defaultMemberDisplayForTab(
  trackIds: number[], activeTrackId: number | null,
): MemberDisplayState {
  const perTrack = new Set<MemberFieldId>(TAB_DEFAULT_FIELDS);
  return {
    hiddenFields: DEFAULT_MEMBER_DISPLAY.hiddenFields.filter((id) => !perTrack.has(id)),
    hiddenTracks: activeTrackId === null ? [] : trackIds
      .filter((id) => id !== activeTrackId)
      .flatMap((id) => TRACK_SCOPED_FIELDS.map((field) => `${field.id}:${id}`)),
    hiddenCustom: [],
  };
}

// Mirrors CARD_FIELD_NAMESPACE / CARD_TRACK_NAMESPACE in
// core/tournament/display_config.py — one flat `hidden` list per surface is
// the storage shape every surface uses, so the two kinds of entry are told
// apart by prefix rather than by two columns.
const CARD_FIELD_PREFIX = "card_field:";
const CARD_TRACK_PREFIX = "card_track:";
const CARD_CUSTOM_PREFIX = "card_custom:";

/** The saved wire shape into display state. `hidden` is one flat namespaced
    list on the server (a whole-field entry, or one field's track slice), so
    the two arrays are split back apart here. Unknown prefixes are dropped:
    a field removed in a later release must not sit in the list hiding
    nothing. */
export function memberDisplayFromHidden(
  hidden: string[] | null | undefined,
): MemberDisplayState {
  // Never saved — not "nothing hidden". An empty saved list is a real state
  // (everything shown), and it must not spring back to the default.
  if (!Array.isArray(hidden)) return DEFAULT_MEMBER_DISPLAY;
  const state: MemberDisplayState = { hiddenFields: [], hiddenTracks: [], hiddenCustom: [] };
  for (const item of hidden) {
    if (typeof item !== "string") continue;
    if (item.startsWith(CARD_FIELD_PREFIX)) {
      state.hiddenFields.push(item.slice(CARD_FIELD_PREFIX.length) as MemberFieldId);
    } else if (item.startsWith(CARD_TRACK_PREFIX)) {
      state.hiddenTracks.push(item.slice(CARD_TRACK_PREFIX.length));
    } else if (item.startsWith(CARD_CUSTOM_PREFIX)) {
      state.hiddenCustom.push(item.slice(CARD_CUSTOM_PREFIX.length));
    }
  }
  return state;
}

/** Display state as the stored wire shape — the inverse of the above. */
export function memberDisplayToHidden(display: MemberDisplayState): string[] {
  return [
    ...display.hiddenFields.map((id) => `${CARD_FIELD_PREFIX}${id}`),
    ...display.hiddenTracks.map((key) => `${CARD_TRACK_PREFIX}${key}`),
    ...display.hiddenCustom.map((id) => `${CARD_CUSTOM_PREFIX}${id}`),
  ];
}

/** Whether two card views hide the same things. Order is not part of the
 *  state — the lists are built by toggling, so the same view reached two
 *  ways can hold its entries in either order. */
export function sameMemberDisplay(a: MemberDisplayState, b: MemberDisplayState): boolean {
  return sameEntries(a.hiddenFields, b.hiddenFields)
    && sameEntries(a.hiddenTracks, b.hiddenTracks)
    && sameEntries(a.hiddenCustom, b.hiddenCustom);
}

function sameEntries(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(b);
  return a.every((entry) => seen.has(entry));
}

export function fieldShown(display: MemberDisplayState, id: MemberFieldId): boolean {
  return !display.hiddenFields.includes(id);
}

export function trackShown(display: MemberDisplayState, id: MemberFieldId, trackId: number): boolean {
  return !display.hiddenTracks.includes(`${id}:${trackId}`);
}

export function customShown(display: MemberDisplayState, fieldId: string): boolean {
  return !display.hiddenCustom.includes(fieldId);
}

function withToggled<T extends string>(list: T[], key: T): T[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

/** Input's label voice — sans caps, tertiary. Every label on the card and in
 *  this modal uses it, so a group heading here reads as the same kind of
 *  thing as the field label it configures. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.07em",
      color: "var(--color-text-tertiary)",
    }}>
      {children}
    </span>
  );
}

function FieldGroup({ label, action, children }: {
  label: string;
  /** Sits on the heading's right edge — the group's own show/hide, for the
   *  three groups whose entire content is one thing. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <FieldLabel>{label}</FieldLabel>
        {action}
      </div>
      {children}
    </div>
  );
}

function FieldCheck({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return <CheckboxRow label={label} checked={checked} onChange={onChange} />;
}

export function MemberDisplayModal({
  display,
  defaults,
  /** The tournament's tracks, for the per-track chip editors — caller-supplied
   *  rather than fetched here, same reasoning as MembersFilterModal's options. */
  tracks,
  customFields,
  onApply,
  onClose,
}: {
  display: MemberDisplayState;
  /** What this tab starts with — defaultMemberDisplayForTab. Reset returns
   *  here rather than to DEFAULT_MEMBER_DISPLAY, which is the baseline the
   *  tab defaults are *built from* and a state no tab is ever actually in:
   *  on Day 2 it hides availability outright and un-hides every other day's
   *  track status and preferences. */
  defaults?: MemberDisplayState;
  tracks: { id: number; label: string }[];
  /** The tournament's custom questions, for the Custom fields chips. */
  customFields: { id: string; label: string }[];
  onApply: (next: MemberDisplayState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MemberDisplayState>(display);

  const toggleField = (id: MemberFieldId) =>
    setDraft((d) => ({ ...d, hiddenFields: withToggled(d.hiddenFields, id) }));
  const toggleTrack = (key: string) =>
    setDraft((d) => ({ ...d, hiddenTracks: withToggled(d.hiddenTracks, key) }));

  const check = (id: MemberFieldId, label: string) => (
    <FieldCheck
      key={id}
      label={label}
      checked={fieldShown(draft, id)}
      onChange={() => toggleField(id)}
    />
  );

  /**
   * A field with an on/off switch and a chip per item it shows — the
   * per-track fields (an item per track) and Custom fields (one per question).
   * Hidden-by-exception, like the rest: a new track or question shows.
   */
  const chipGroup = <T extends string | number>(
    id: MemberFieldId, label: string, items: { id: T; label: string }[],
    shown: (item: T) => boolean, toggle: (item: T) => void, hideAll: () => void,
    addTitle: string,
  ) => (
    <FieldGroup
      key={id}
      label={label}
      action={<Switch checked={fieldShown(draft, id)} onChange={() => toggleField(id)} />}
    >
      {/* `disabled`, not `locked`: switched off by its own toggle, the chips
          stay greyed on screen — what turning it back on would show. */}
      <div>
        <ChipInput
          disabled={!fieldShown(draft, id)}
          value={items.filter((item) => shown(item.id)).map((item) => item.label)}
          onChange={(labels) => {
            const removed = items.find((item) => shown(item.id) && !labels.includes(item.label));
            if (removed) toggle(removed.id);
          }}
          variant="transparent"
          size="sm"
          disableInput
          fullWidth
          onClear={hideAll}
          addButton={
            <ChecklistPopover
              trigger={
                <Button
                  type="button" variant="secondary" size="sm" iconOnly
                  title={addTitle} style={{ padding: 0, flexShrink: 0 }}
                >
                  <IconPlus size={13} />
                </Button>
              }
              items={items}
              getKey={(item) => item.id}
              renderLabel={(item) => item.label}
              isSelected={(item) => shown(item.id)}
              onToggle={(item) => toggle(item.id)}
              emptyMessage="Nothing to configure"
            />
          }
        />
      </div>
    </FieldGroup>
  );

  /**
   * The per-track fields, each as its own group.
   *
   * They used to be a checkbox in the field list plus a chip row in a shared
   * "Tracks" block, which split one decision across two places you had to
   * scroll between. Whether the field shows and which of its tracks show are
   * the same subject, so they sit together: the toggle names the group, and
   * the chips are what it contains.
   */
  const trackGroup = (id: MemberFieldId, label: string) => chipGroup(
    id, label, tracks,
    (trackId) => trackShown(draft, id, trackId),
    (trackId) => toggleTrack(`${id}:${trackId}`),
    () => setDraft((d) => ({
      ...d,
      hiddenTracks: [
        ...d.hiddenTracks.filter((key) => !key.startsWith(`${id}:`)),
        ...tracks.map((t) => `${id}:${t.id}`),
      ],
    })),
    "Edit visible tracks",
  );

  return (
    <Modal title="Configure member cards" onClose={onClose} width={640}>
      <div style={{
        maxHeight: "60vh", overflowY: "auto", paddingRight: "4px",
        display: "flex", flexDirection: "column", gap: "20px",
      }}>
        <FieldGroup label="Membership">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {check("roles", "Roles")}
            {check("age", "Age")}
            {check("onboarding", "Onboarding")}
            {check("dietary_restriction", "Dietary restriction")}
          </div>
        </FieldGroup>

        {TRACK_SCOPED_FIELDS.map(({ id, label }) => trackGroup(id, label))}

        <FieldGroup label="Competition experience">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {check("competition_school", "School")}
            {check("competition_event", "Event")}
          </div>
        </FieldGroup>

        <FieldGroup label="Volunteer experience">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {check("volunteer_tournament", "Year & tournament")}
            {check("volunteer_event", "Event")}
            {check("volunteer_role", "Role")}
          </div>
        </FieldGroup>

        {chipGroup(
          "custom_fields", "Custom fields", customFields,
          (fieldId) => customShown(draft, fieldId),
          (fieldId) => setDraft((d) => ({ ...d, hiddenCustom: withToggled(d.hiddenCustom, fieldId) })),
          () => setDraft((d) => ({ ...d, hiddenCustom: customFields.map((f) => f.id) })),
          "Edit visible questions",
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "16px" }}>
        <Button type="button" variant="ghost" onClick={() => setDraft(defaults ?? DEFAULT_MEMBER_DISPLAY)}>
          Reset
        </Button>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { onApply(draft); onClose(); }}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
