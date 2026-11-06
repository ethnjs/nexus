"use client";

import { useEffect, useState } from "react";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Card } from "@/components/ui/Card";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { type MassNote, MassResultsCard } from "@/components/ui/MassResultsCard";
import {
  ApiError,
  type CanonicalEvent,
  EVENT_FORMAT_LABELS,
  EVENT_FORMATS,
  type EventFormat,
  type SeasonEvent,
  type SeasonEventInput,
  seasonEventsApi,
  TOURNAMENT_DIVISIONS,
  type TournamentDivision,
} from "@/lib/api";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

export const SEASON_MASS_EDITOR_WIDTH = 440;

const NO_FORMAT = "none";

const ON_OFF = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/** Unset fields are left alone on every selected event. */
interface SeasonMassDraft {
  format?: EventFormat | null;
  has_impound?: boolean;
  has_self_schedule?: boolean;
  divisions: Partial<Record<TournamentDivision, boolean>>;
}

const EMPTY_DRAFT: SeasonMassDraft = { divisions: {} };

interface EventResult {
  event: CanonicalEvent;
  error?: string;
  notes?: MassNote[];
}

const onOff = (v: boolean | undefined) => (v === undefined ? "" : v ? "on" : "off");

export function SeasonMassEditor({
  year,
  events,
  seasonEvents,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  year: number;
  events: CanonicalEvent[];
  /** This season's rows, every division of every event. */
  seasonEvents: SeasonEvent[];
  onClose: () => void;
  /** After a save, so the caller can reload the season's rows. */
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { guard } = useUnsavedChanges();
  const [draft, setDraft] = useState<SeasonMassDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<EventResult[] | null>(null);

  const isDirty =
    draft.format !== undefined ||
    draft.has_impound !== undefined ||
    draft.has_self_schedule !== undefined ||
    Object.keys(draft.divisions).length > 0;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  async function saveOne(event: CanonicalEvent): Promise<MassNote[]> {
    const rows = seasonEvents.filter((s) => s.event.id === event.id);
    const notes: MassNote[] = [];

    // Through one row: the backend copies the change to the event's other
    // divisions, and a division added below takes it from them.
    const details: Partial<SeasonEventInput> = {};
    if (draft.format !== undefined) details.format = draft.format;
    if (draft.has_impound !== undefined) details.has_impound = draft.has_impound;
    if (draft.has_self_schedule !== undefined) details.has_self_schedule = draft.has_self_schedule;
    const target = rows.find((r) => r.is_active) ?? rows[0];
    if (Object.keys(details).length > 0 && target) {
      await seasonEventsApi.update(target.id, details);
    }

    for (const division of TOURNAMENT_DIVISIONS) {
      const on = draft.divisions[division];
      if (on === undefined) continue;
      const row = rows.find((r) => r.division === division);
      if (on && !row) {
        await seasonEventsApi.create({ event_id: event.id, year, division, is_active: true });
      } else if (on && row && !row.is_active) {
        await seasonEventsApi.update(row.id, { is_active: true });
      } else if (!on && row) {
        await seasonEventsApi.delete(row.id);
      } else {
        notes.push({ text: `already ${on ? "in" : "not in"} Division ${division}`, tone: "muted" });
      }
    }
    return notes;
  }

  async function handleSave() {
    setSaving(true);
    setResults(null);
    const outcomes = await Promise.allSettled(events.map(saveOne));
    setResults(
      outcomes.map((outcome, i) =>
        outcome.status === "fulfilled"
          ? { event: events[i], notes: outcome.value }
          : {
              event: events[i],
              error:
                outcome.reason instanceof ApiError ? outcome.reason.message : "Failed to save.",
            },
      ),
    );
    setDraft(EMPTY_DRAFT);
    setSaving(false);
    onSaved();
  }

  return (
    <DockedPanel
      onClose={() => guard(onClose)}
      width={SEASON_MASS_EDITOR_WIDTH}
      footer={
        <FloatingSaveBar
          visible={isDirty}
          saving={saving}
          onSave={handleSave}
          onCancel={() => setDraft(EMPTY_DRAFT)}
        />
      }
    >
      <div style={{ padding: `20px 28px ${isDirty ? "100px" : "20px"}` }}>
        <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
            Edit {events.length} events
          </h2>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-text-tertiary)",
              marginTop: "4px",
            }}
          >
            Only fields you change below are applied — the rest are left as-is on every selected
            event.
          </p>
        </Card>

        <SettingsSection title="Fields to apply">
          <SettingsRow label="Format">
            <ButtonGroup
              options={[
                ...EVENT_FORMATS.map((f) => ({ value: f, label: EVENT_FORMAT_LABELS[f] })),
                { value: NO_FORMAT, label: "None" },
              ]}
              value={draft.format === undefined ? "" : (draft.format ?? NO_FORMAT)}
              onChange={(v) =>
                setDraft((d) => ({ ...d, format: v === NO_FORMAT ? null : (v as EventFormat) }))
              }
            />
          </SettingsRow>
          <SettingsRow label="Impound">
            <ButtonGroup
              options={ON_OFF}
              value={onOff(draft.has_impound)}
              onChange={(v) => setDraft((d) => ({ ...d, has_impound: v === "on" }))}
            />
          </SettingsRow>
          <SettingsRow label="Self-schedule" last>
            <ButtonGroup
              options={ON_OFF}
              value={onOff(draft.has_self_schedule)}
              onChange={(v) => setDraft((d) => ({ ...d, has_self_schedule: v === "on" }))}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Divisions">
          {TOURNAMENT_DIVISIONS.map((division, i) => (
            <SettingsRow
              key={division}
              label={`Division ${division}`}
              last={i === TOURNAMENT_DIVISIONS.length - 1}
            >
              <ButtonGroup
                options={ON_OFF}
                value={onOff(draft.divisions[division])}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    divisions: { ...d.divisions, [division]: v === "on" },
                  }))
                }
              />
            </SettingsRow>
          ))}
        </SettingsSection>

        {results && (
          <MassResultsCard
            results={results.map((r) => ({
              key: r.event.id,
              label: r.event.name,
              error: r.error,
              notes: r.notes,
            }))}
          />
        )}
      </div>
    </DockedPanel>
  );
}
