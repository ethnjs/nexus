"use client";

import { useEffect, useMemo, useState } from "react";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { trackDays } from "@/components/tournament/TrackDayPicker";
import { Card } from "@/components/ui/Card";
import { Dropdown } from "@/components/ui/Dropdown";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { type MassResult, MassResultsCard } from "@/components/ui/MassResultsCard";
import { TimeRangePicker } from "@/components/ui/TimeRangePicker";
import {
  ApiError,
  type TournamentShift,
  type TournamentTrack,
  tournamentShiftsApi,
} from "@/lib/api";
import { fromDayAndTime, toDateInput, toTimeInput } from "@/lib/timeFormat";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MASS_SHIFT_EDITOR_WIDTH = 480;

// Blank means "leave each shift's own value alone". No label or day: those
// are per-shift enough that blanket-applying them would almost always be wrong.
interface MassShiftDraft {
  trackId: number | null;
  startTime: string;
  endTime: string;
}

const EMPTY_DRAFT: MassShiftDraft = { trackId: null, startTime: "", endTime: "" };

/** One shift with the draft laid over it, or why it can't take it. Moving
 *  track keeps the day when the new track runs that day, else takes its first
 *  day — the same rule ShiftPanel applies when its track changes. */
function applyDraft(shift: TournamentShift, draft: MassShiftDraft, tracks: TournamentTrack[]) {
  const trackId = draft.trackId ?? shift.track_id;
  let day = toDateInput(shift.start);
  if (trackId !== shift.track_id) {
    const days = trackDays(tracks.find((t) => t.id === trackId));
    if (!days.includes(day)) day = days[0] ?? day;
  }
  const startTime = draft.startTime || toTimeInput(shift.start);
  const endTime = draft.endTime || toTimeInput(shift.end);
  if (endTime <= startTime) throw new Error("End must be after the start.");
  return {
    track_id: trackId,
    start: fromDayAndTime(day, startTime)!,
    end: fromDayAndTime(day, endTime)!,
  };
}

interface MassShiftEditorProps {
  tournamentId: number;
  shifts: TournamentShift[];
  /** Competition days — the only tracks a shift can sit on. */
  tracks: TournamentTrack[];
  onClose: () => void;
  /** Every shift that saved, in one call, so the page reloads tracks once. */
  onSaved: (updated: TournamentShift[]) => void;
  /** Lets the owning table block selection changes while this panel is dirty. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function MassShiftEditor({
  tournamentId,
  shifts,
  tracks,
  onClose,
  onSaved,
  onDirtyChange,
}: MassShiftEditorProps) {
  const { guard } = useUnsavedChanges();
  const [draft, setDraft] = useState<MassShiftDraft>(EMPTY_DRAFT);
  // A pending-delete track can't take a new shift — the backend 409s.
  const moveTargets = useMemo(() => tracks.filter((t) => !t.is_archived), [tracks]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<MassResult[] | null>(null);

  const isDirty = draft.trackId !== null || draft.startTime !== "" || draft.endTime !== "";
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  async function handleSave() {
    setSaving(true);
    setResults(null);
    const outcomes = await Promise.allSettled(
      shifts.map((shift) =>
        tournamentShiftsApi.update(tournamentId, shift.id, applyDraft(shift, draft, tracks)),
      ),
    );

    const saved: TournamentShift[] = [];
    const nextResults: MassResult[] = outcomes.map((outcome, i) => {
      const shift = shifts[i];
      if (outcome.status === "fulfilled") {
        saved.push(outcome.value);
        return { key: shift.id, label: shift.label };
      }
      const err = outcome.reason;
      return {
        key: shift.id,
        label: shift.label,
        error: err instanceof ApiError || err instanceof Error ? err.message : "Failed to save.",
      };
    });
    if (saved.length > 0) onSaved(saved);
    setResults(nextResults);
    setDraft(EMPTY_DRAFT);
    setSaving(false);
  }

  return (
    <DockedPanel
      onClose={() => guard(onClose)}
      width={MASS_SHIFT_EDITOR_WIDTH}
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
            Edit {shifts.length} shifts
          </h2>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-text-tertiary)",
              marginTop: "4px",
            }}
          >
            Only fields you set below are applied — the rest stay as-is on every selected shift.
          </p>
        </Card>

        <SettingsSection title="Fields to apply">
          {/* Hidden rather than locked when there is one track: unlike the
              other pickers, this one's value is "move them" — with a single
              destination every shift is already there, so there is no state
              for a locked control to report. */}
          {moveTargets.length > 1 && (
            <SettingsRow
              label="Track"
              helper="A shift keeps its day if the new track runs it, otherwise it moves to the track's first day."
            >
              <Dropdown
                fullWidth
                value={draft.trackId !== null ? String(draft.trackId) : ""}
                onChange={(v) => setDraft((d) => ({ ...d, trackId: v ? Number(v) : null }))}
                options={[
                  { value: "", label: "Keep each shift's track" },
                  ...moveTargets.map((t) => ({ value: String(t.id), label: t.name })),
                ]}
              />
            </SettingsRow>
          )}

          <SettingsRow label="Time" helper="Leave either end blank to keep each shift's own." last>
            <TimeRangePicker
              aria-label="Time"
              openEnds
              fullWidth
              start={draft.startTime}
              end={draft.endTime}
              onChange={(start, end) => setDraft((d) => ({ ...d, startTime: start, endTime: end }))}
            />
          </SettingsRow>
        </SettingsSection>

        {results && <MassResultsCard results={results} />}
      </div>
    </DockedPanel>
  );
}
