"use client";

import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import {
  type Role,
  TOURNAMENT_DIVISIONS,
  type TournamentDivision,
  type University,
} from "@/lib/api";
import { todayLocalDateString } from "@/lib/date";
import { formatDayRange, TBD } from "@/lib/tournamentDisplay";
import type { TrackDraft } from "@/lib/trackDraft";

// Dropdown's value is a string; a track's default_role_id is nullable, so
// "no default" needs a sentinel rather than an empty string collapsing into
// the placeholder for every unrelated reason a value could be blank.
const NO_DEFAULT_ROLE = "__none__";

/**
 * The primary/cosmetic fields, shared by every row. The when/where/what only
 * renders for a competition day — that is what keeps the "only a primary
 * track can have..." 422 unreachable from this UI. Default role is the one
 * field every track carries regardless: a cosmetic track like Test Writing
 * wants its own default just as much as a competition day does.
 */
export function TrackFields({
  draft,
  errors,
  universities,
  roles,
  locked,
  onChange,
  showPrimaryToggle = true,
}: {
  draft: TrackDraft;
  errors: Record<string, string>;
  universities: University[];
  roles: Role[];
  locked: boolean;
  onChange: (updates: Partial<TrackDraft>) => void;
  /** Off in simple mode, where the sole track is necessarily a competition
   *  day — the backend refuses to leave a tournament without one, so the
   *  toggle would offer an action that can only 409. */
  showPrimaryToggle?: boolean;
}) {
  // An existing multi-day track shows both inputs on its own; the checkbox
  // only has to remember the case where the TD is on their way to entering
  // an end date that doesn't differ from the start yet.
  const [spansDays, setSpansDays] = useState(false);
  const multiDay = spansDays || (!!draft.end_date && draft.end_date !== draft.start_date);
  const today = todayLocalDateString();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {showPrimaryToggle && (
        <FieldRow
          label="Competition day"
          helper="Has a date, venue and divisions. Only competition days can have shifts."
        >
          <Switch
            checked={draft.is_primary}
            onChange={(v) => onChange({ is_primary: v })}
            locked={locked}
          />
        </FieldRow>
      )}

      {draft.is_primary && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", gap: "10px" }}>
              {/* TBD keeps the field in place reading "TBD" rather than
                  removing it — the row shouldn't reflow, and the TD should be
                  able to see what the track will say. `type` swaps to text
                  because a date input can't display anything but a date. */}
              <Input
                label={multiDay && !draft.dates_tbd ? "Start" : "Date"}
                required
                type={draft.dates_tbd ? "text" : "date"}
                fullWidth
                locked={locked || draft.dates_tbd}
                min={today}
                value={draft.dates_tbd ? TBD : draft.start_date}
                // Single-day tracks keep end_date in step with start_date —
                // the backend requires both on a competition day, and the TD
                // has said this one doesn't span days.
                onChange={(e) =>
                  onChange(
                    multiDay
                      ? { start_date: e.target.value }
                      : { start_date: e.target.value, end_date: e.target.value },
                  )
                }
                error={errors.start_date}
              />
              {multiDay && !draft.dates_tbd && (
                <Input
                  label="End"
                  required
                  type="date"
                  fullWidth
                  locked={locked}
                  min={draft.start_date || today}
                  value={draft.end_date}
                  onChange={(e) => onChange({ end_date: e.target.value })}
                  error={errors.end_date}
                />
              )}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: locked || draft.dates_tbd ? "default" : "pointer",
              }}
            >
              <Checkbox
                checked={multiDay && !draft.dates_tbd}
                locked={locked || draft.dates_tbd}
                onChange={(checked) => {
                  setSpansDays(checked);
                  if (!checked) onChange({ end_date: draft.start_date });
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                }}
              >
                Runs more than one day
              </span>
            </label>
            <TbdCheckbox
              label="Date not decided yet"
              checked={draft.dates_tbd}
              locked={locked}
              // Clearing the dates is the point: TBD is stored as their
              // absence, so leaving stale values behind would save a date the
              // TD has just said they don't have.
              onChange={(checked) => {
                setSpansDays(false);
                onChange(
                  checked
                    ? { dates_tbd: true, start_date: "", end_date: "" }
                    : { dates_tbd: false },
                );
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Combobox
              label="Location"
              required
              options={universities}
              getId={(u) => u.id}
              getLabel={(u) => u.name}
              getSearchText={(u) => `${u.name} ${u.abbreviation ?? ""}`}
              value={draft.location_tbd ? TBD : draft.location}
              onChange={(text, matched) =>
                onChange({ location: text, university_id: matched?.id ?? null })
              }
              placeholder="e.g. UCI"
              locked={locked || draft.location_tbd}
              error={errors.location}
            />
            <TbdCheckbox
              label="Venue not decided yet"
              checked={draft.location_tbd}
              locked={locked}
              onChange={(checked) =>
                onChange(
                  checked
                    ? { location_tbd: true, location: "", university_id: null }
                    : { location_tbd: false },
                )
              }
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--color-text-tertiary)",
                marginBottom: "6px",
              }}
            >
              Division<span style={{ color: "var(--color-danger)" }}> *</span>
            </div>
            <DivisionButtonGroup
              options={TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: d }))}
              value={draft.division}
              onChange={(v) =>
                onChange({
                  division: draft.division.includes(v as TournamentDivision)
                    ? draft.division.filter((x) => x !== v)
                    : [...draft.division, v as TournamentDivision],
                })
              }
              locked={locked}
            />
            {errors.division && (
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "12px",
                  color: "var(--color-danger)",
                  margin: "6px 0 0",
                }}
              >
                {errors.division}
              </p>
            )}
          </div>
        </>
      )}

      <FieldRow
        label="Default role"
        helper="The role the assignments board grants when someone is placed on this track with no role picked yet."
      >
        <Dropdown
          value={draft.default_role_id === null ? NO_DEFAULT_ROLE : String(draft.default_role_id)}
          onChange={(v) => onChange({ default_role_id: v === NO_DEFAULT_ROLE ? null : Number(v) })}
          options={[
            { value: NO_DEFAULT_ROLE, label: "None" },
            ...roles.map((r) => ({ value: String(r.id), label: r.label })),
          ]}
          locked={locked}
          size="sm"
          width={180}
        />
      </FieldRow>
    </div>
  );
}

/**
 * "Not decided yet" for a date or a venue. Ticking it is how a TD says TBD
 * out loud — the field it replaces is required otherwise, so a competition
 * day can never be saved simply blank. The stored form is still absence; see
 * trackDraftPayload.
 */
export function TbdCheckbox({
  label,
  checked,
  locked,
  onChange,
}: {
  label: string;
  checked: boolean;
  locked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: locked ? "default" : "pointer",
      }}
    >
      <Checkbox checked={checked} locked={locked} onChange={onChange} />
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: "var(--color-text-secondary)",
        }}
      >
        {label}
      </span>
    </label>
  );
}

export function FieldRow({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-primary)",
          }}
        >
          {label}
        </div>
        {helper && (
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "12px",
              color: "var(--color-text-tertiary)",
              marginTop: "2px",
            }}
          >
            {helper}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * The one-line "where and when" for a collapsed track row, read off a draft
 * rather than a saved track — so an accordion shows what has been typed, not
 * what was last saved.
 */
export function TrackSummary({ draft }: { draft: TrackDraft }) {
  if (!draft.is_primary) return null;
  // TBD reads the same here as it does everywhere else the track is shown, so
  // collapsing a row the TD has just marked TBD doesn't blank the line out.
  const dates = draft.dates_tbd
    ? TBD
    : formatDayRange(draft.start_date || null, draft.end_date || null);
  const place = draft.location_tbd ? TBD : draft.location.trim() || null;
  if (!place && !dates && draft.division.length === 0) return null;

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: 0,
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        color: "var(--color-text-tertiary)",
      }}
    >
      {place && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <IconLocation />
          {place}
        </span>
      )}
      {dates && (
        <span style={{ display: "flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
          <IconCalendar />
          {dates}
        </span>
      )}
      {draft.division.map((d) => (
        <Badge key={d}>{d}</Badge>
      ))}
    </span>
  );
}
