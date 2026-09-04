"use client";

import { ReactNode, useState } from "react";
import { TournamentDivision, University, TOURNAMENT_DIVISIONS } from "@/lib/api";
import { TrackDraft } from "@/lib/trackDraft";
import { todayLocalDateString } from "@/lib/date";
import { formatDayRange } from "@/lib/tournamentDisplay";
import { Badge } from "@/components/ui/Badge";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";

/**
 * The primary/cosmetic fields, shared by every row. The when/where/what only
 * renders for a competition day — that is what keeps the "only a primary
 * track can have..." 422 unreachable from this UI.
 */
export function TrackFields({ draft, errors, universities, locked, onChange }: {
  draft: TrackDraft;
  errors: Record<string, string>;
  universities: University[];
  locked: boolean;
  onChange: (updates: Partial<TrackDraft>) => void;
}) {
  // An existing multi-day track shows both inputs on its own; the checkbox
  // only has to remember the case where the TD is on their way to entering
  // an end date that doesn't differ from the start yet.
  const [spansDays, setSpansDays] = useState(false);
  const multiDay = spansDays || (!!draft.end_date && draft.end_date !== draft.start_date);
  const today = todayLocalDateString();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <FieldRow label="Competition day" helper="Carries dates, a venue and divisions. Only these hold shifts.">
        <Toggle checked={draft.is_primary} onChange={(v) => onChange({ is_primary: v })} locked={locked} />
      </FieldRow>

      {draft.is_primary && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", gap: "10px" }}>
              <Input
                label={multiDay ? "Start" : "Date"} required type="date" fullWidth locked={locked}
                min={today}
                value={draft.start_date}
                // Single-day tracks keep end_date in step with start_date —
                // the backend requires both on a competition day, and the TD
                // has said this one doesn't span days.
                onChange={(e) => onChange(
                  multiDay
                    ? { start_date: e.target.value }
                    : { start_date: e.target.value, end_date: e.target.value },
                )}
                error={errors.start_date}
              />
              {multiDay && (
                <Input
                  label="End" required type="date" fullWidth locked={locked}
                  min={draft.start_date || today}
                  value={draft.end_date}
                  onChange={(e) => onChange({ end_date: e.target.value })}
                  error={errors.end_date}
                />
              )}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: locked ? "default" : "pointer" }}>
              <Checkbox
                checked={multiDay}
                locked={locked}
                onChange={(checked) => {
                  setSpansDays(checked);
                  if (!checked) onChange({ end_date: draft.start_date });
                }}
              />
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Runs more than one day
              </span>
            </label>
          </div>
          <Combobox
            label="Location"
            required
            options={universities}
            getId={(u) => u.id}
            getLabel={(u) => u.name}
            getSearchText={(u) => `${u.name} ${u.abbreviation ?? ""}`}
            value={draft.location}
            onChange={(text, matched) => onChange({ location: text, university_id: matched?.id ?? null })}
            placeholder="e.g. UCI"
            locked={locked}
            error={errors.location}
          />
          <div>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.07em",
              color: "var(--color-text-tertiary)", marginBottom: "6px",
            }}>
              Division<span style={{ color: "var(--color-danger)" }}> *</span>
            </div>
            <ButtonGroup
              options={TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: d }))}
              value={draft.division}
              onChange={(v) => onChange({
                division: draft.division.includes(v as TournamentDivision)
                  ? draft.division.filter((x) => x !== v)
                  : [...draft.division, v as TournamentDivision],
              })}
              locked={locked}
            />
            {errors.division && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", margin: "6px 0 0" }}>
                {errors.division}
              </p>
            )}
          </div>
        </>
      )}

      {/* Not "members confirm themselves vs the TD confirming for them" — a
          TD never confirms on a member's behalf. This is the gate on
          confirmation being open at all, usually flipped when the
          confirmation form goes out about a week ahead. */}
      <FieldRow
        label="Members can confirm"
        helper="Turn on when confirmations open. Until then members can only say they're interested, or decline."
      >
        <Toggle checked={draft.allow_confirm} onChange={(v) => onChange({ allow_confirm: v })} locked={locked} />
      </FieldRow>
    </div>
  );
}

export function FieldRow({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>{label}</div>
        {helper && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
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
  const dates = formatDayRange(draft.start_date || null, draft.end_date || null);
  const place = draft.location.trim() || null;
  if (!place && !dates && draft.division.length === 0) return null;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
      {place && (
        <span style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <IconLocation />{place}
        </span>
      )}
      {dates && (
        <span style={{ display: "flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
          <IconCalendar />{dates}
        </span>
      )}
      {draft.division.map((d) => <Badge key={d}>{d}</Badge>)}
    </span>
  );
}
