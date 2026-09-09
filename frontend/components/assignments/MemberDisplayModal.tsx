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
 * Nothing here talks to an API — the assignments board keeps this display
 * config in memory rather than persisting it through displayConfigApi like
 * the panel does, so the filtering happens at render time in the card itself.
 */
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconPlus } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { Popover } from "@/components/ui/Popover";
import { Toggle } from "@/components/ui/Toggle";

export type MemberFieldId =
  | "roles"
  | "age"
  | "track_status"
  | "event_preferences"
  | "availability"
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
];

/**
 * Hidden-by-exception: anything not named in a `hidden*` array is shown, so a
 * field added later is visible without migrating saved state.
 */
export interface MemberDisplayState {
  hiddenFields: MemberFieldId[];
  /** "{fieldId}:{trackId}". */
  hiddenTracks: string[];
}

export const DEFAULT_MEMBER_DISPLAY: MemberDisplayState = {
  // A belt card is scanned at a glance mid-drag. Everything on turns it into
  // a wall, so the experience tables and availability start off — they answer
  // a question you ask about one person, not about the row you are staffing.
  hiddenFields: [
    "availability",
    "competition_school", "competition_event",
    "volunteer_tournament", "volunteer_event", "volunteer_role",
  ],
  hiddenTracks: [],
};

export function fieldShown(display: MemberDisplayState, id: MemberFieldId): boolean {
  return !display.hiddenFields.includes(id);
}

export function trackShown(display: MemberDisplayState, id: MemberFieldId, trackId: number): boolean {
  return !display.hiddenTracks.includes(`${id}:${trackId}`);
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
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
      <Checkbox checked={checked} onChange={onChange} />
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{label}</span>
    </label>
  );
}

export function MemberDisplayModal({
  display,
  /** The tournament's tracks, for the per-track chip editors — caller-supplied
   *  rather than fetched here, same reasoning as MembersFilterModal's options. */
  tracks,
  onApply,
  onClose,
}: {
  display: MemberDisplayState;
  tracks: { id: number; label: string }[];
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
   * The three per-track fields, each as its own group.
   *
   * They used to be a checkbox in the field list plus a chip row in a shared
   * "Tracks" block, which split one decision across two places you had to
   * scroll between. Whether the field shows and which of its tracks show are
   * the same subject, so they sit together: the toggle names the group, and
   * the chips are what it contains.
   */
  const trackGroup = (id: MemberFieldId, label: string) => (
    <FieldGroup
      key={id}
      label={label}
      action={
        <Toggle checked={fieldShown(draft, id)} onChange={() => toggleField(id)} />
      }
    >
      {/* `disabled`, not `locked`: the group is switched off by its own
          toggle, so the chips and the add button stay on screen greyed — you
          are meant to see what turning it back on would show. Hiding them
          would make the row look broken rather than paused. */}
      <div>
        <ChipInput
          disabled={!fieldShown(draft, id)}
          value={tracks
            .filter((t) => trackShown(draft, id, t.id))
            .map((t) => t.label)}
          onChange={(labels) => {
            const removed = tracks.find(
              (t) => trackShown(draft, id, t.id) && !labels.includes(t.label),
            );
            if (removed) toggleTrack(`${id}:${removed.id}`);
          }}
          variant="transparent"
          size="sm"
          disableInput
          fullWidth
          addButton={
            <Popover
              trigger={
                <Button
                  type="button" variant="secondary" size="sm" iconOnly
                  title="Edit visible tracks" style={{ padding: 0, flexShrink: 0 }}
                >
                  <IconPlus size={13} />
                </Button>
              }
              items={tracks}
              getKey={(track) => track.id}
              renderLabel={(track) => track.label}
              checklist
              isSelected={(track) => trackShown(draft, id, track.id)}
              onSelect={(track) => toggleTrack(`${id}:${track.id}`)}
              emptyMessage="Nothing to configure"
            />
          }
        />
      </div>
    </FieldGroup>
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
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "16px" }}>
        <Button type="button" variant="ghost" onClick={() => setDraft(DEFAULT_MEMBER_DISPLAY)}>
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
