"use client";

import { useMemo, useState } from "react";
import {
  tournamentEventsApi, ApiError, TournamentEvent, TournamentEventInput, TournamentDivision,
} from "@/lib/api";
import { toDateInput, fromDayAndTime, formatDayLabel } from "@/lib/timeFormat";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { useTournament } from "@/lib/useTournament";
import { SidePanel } from "@/components/ui/SidePanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";

// Only fields shared and safe to blanket-apply across arbitrary events —
// name/category/building/room/etc. are per-event enough that mass-editing
// them would almost always be wrong. Day is deliberately excluded too: it
// isn't offered here, only time-of-day, applied against each event's own
// existing date.
interface MassEventDraft {
  division?: TournamentDivision;
  event_type?: "standard" | "trial";
  // Only meaningful once start or end is touched — combined with startTime/
  // endTime to build each event's new start_time/end_time. Not itself a
  // mass-editable field on TournamentEvent (there's no bare "day" column).
  day?: string;
  startTime?: string;
  endTime?: string;
}

interface EventResult {
  event: TournamentEvent;
  error?: string;
}

interface MassEventEditorProps {
  tournamentId: number;
  events: TournamentEvent[];
  onClose: () => void;
  /** Called once per event that saved successfully, so the caller can patch its local list the same way EventPanel's onSaved does. */
  onSaved: (updated: TournamentEvent) => void;
}

export function MassEventEditor({ tournamentId, events, onClose, onSaved }: MassEventEditorProps) {
  const { selectedTournament, days, isMultiDay } = useTournament();
  const divisions = selectedTournament?.division ?? [];

  const [draft, setDraft] = useState<MassEventDraft>({});
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<EventResult[] | null>(null);

  const isDirty = draft.division !== undefined || draft.event_type !== undefined
    || draft.startTime !== undefined || draft.endTime !== undefined;

  const touchesTime = draft.startTime !== undefined || draft.endTime !== undefined;

  // Explicit day pick wins (needed once any selected event has no date of
  // its own yet); a single-day tournament has only one valid day so it
  // never needs asking; otherwise each event keeps whatever day it already
  // has — mass-editing time-of-day shouldn't silently move an event to a
  // different day than the one it was already scheduled on.
  function resolveDay(event: TournamentEvent): string | null {
    if (draft.day) return draft.day;
    if (!isMultiDay && days[0]) return days[0];
    if (event.start_time) return toDateInput(event.start_time);
    if (event.end_time) return toDateInput(event.end_time);
    return null;
  }

  async function handleApply() {
    setSaving(true);
    setResults(null);

    const outcomes = await Promise.allSettled(events.map((event) => {
      const patch: Partial<TournamentEventInput> = {};
      if (draft.division !== undefined) patch.division = draft.division;
      if (draft.event_type !== undefined) patch.event_type = draft.event_type;

      if (touchesTime) {
        const day = resolveDay(event);
        if (!day) return Promise.reject(new Error("No date set on this event — pick a Day above to apply a time change."));
        if (draft.startTime !== undefined) patch.start_time = fromDayAndTime(day, draft.startTime);
        if (draft.endTime !== undefined) patch.end_time = fromDayAndTime(day, draft.endTime);
      }

      return tournamentEventsApi.update(tournamentId, event.id, patch);
    }));

    const nextResults: EventResult[] = [];
    outcomes.forEach((outcome, i) => {
      const event = events[i];
      if (outcome.status === "fulfilled") {
        onSaved(outcome.value);
        nextResults.push({ event: outcome.value });
      } else {
        const err = outcome.reason;
        nextResults.push({ event, error: err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to update." });
      }
    });
    setResults(nextResults);
    setSaving(false);
  }

  const failureCount = results?.filter((r) => r.error).length ?? 0;
  const successCount = results ? results.length - failureCount : 0;

  return (
    <SidePanel onClose={onClose} width={480}>
      <div style={{ padding: "20px 28px" }}>
        <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
            Edit {events.length} events
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            Only fields you change below are applied — the rest are left as-is on every selected event.
          </p>
        </Card>

        <SettingsSection title="Fields to apply">
          <SettingsRow label="Division">
            <ButtonGroup
              options={divisions.map((d) => ({ value: d, label: d }))}
              value={draft.division ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, division: v as TournamentDivision }))}
            />
          </SettingsRow>

          <SettingsRow label="Type">
            <ButtonGroup
              options={[{ value: "standard", label: "Standard" }, { value: "trial", label: "Trial" }]}
              value={draft.event_type ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, event_type: v as "standard" | "trial" }))}
            />
          </SettingsRow>

          {touchesTime && isMultiDay && (
            <SettingsRow label="Day" helper="Needed to apply a time change — events keep their own day otherwise.">
              <Dropdown
                value={draft.day ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, day: v || undefined }))}
                options={days.map((d) => ({ value: d, label: formatDayLabel(d) }))}
              />
            </SettingsRow>
          )}

          <SettingsRow label="Start">
            <Input
              type="time" fullWidth
              value={draft.startTime ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value || undefined }))}
            />
          </SettingsRow>

          <SettingsRow label="End" last>
            <Input
              type="time" fullWidth
              value={draft.endTime ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value || undefined }))}
            />
          </SettingsRow>
        </SettingsSection>

        {results && (
          <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
              marginBottom: "10px",
            }}>
              {successCount} updated, {failureCount} failed
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {results.map((r) => (
                <p key={r.event.id} style={{ fontFamily: "var(--font-sans)", fontSize: "12px" }}>
                  <span style={{ fontWeight: 500 }}>{eventNameWithDivision(r.event)}</span>{" "}
                  {r.error ? (
                    <span style={{ color: "var(--color-danger)" }}>— {r.error}</span>
                  ) : (
                    <span style={{ color: "var(--color-success)" }}>— updated</span>
                  )}
                </p>
              ))}
            </div>
          </Card>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {results ? "Close" : "Cancel"}
          </Button>
          {!results && (
            <Button type="button" variant="primary" size="md" onClick={handleApply} disabled={!isDirty || saving}>
              {saving ? "Applying…" : `Apply to ${events.length} events`}
            </Button>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
