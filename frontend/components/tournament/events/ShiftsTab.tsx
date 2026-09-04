"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  tournamentShiftsApi, tournamentEventsApi, tournamentTracksApi, ApiError,
  TournamentEvent, TournamentShift, TournamentTrack,
} from "@/lib/api";
import { formatTimeOfDay, formatDayLabel, toDateInput, toTimeInput } from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShiftPanel, SHIFT_PANEL_WIDTH } from "@/components/tournament/events/ShiftPanel";
import { DeleteShiftModal } from "@/components/tournament/events/DeleteShiftModal";
import { IconPlus, IconCalendar, IconEdit, IconTrash } from "@/components/ui/Icons";

// Label / Track / Day / Start / End / Events / Actions
const SHIFT_ROW_COLUMNS = "1.5fr 1fr 1.1fr 0.7fr 0.7fr 70px 80px";

const ALL_TRACKS = "all";

interface ShiftsTabProps {
  tournamentId: number;
  canManageEvents: boolean;
}

export function ShiftsTab({ tournamentId, canManageEvents }: ShiftsTabProps) {
  const { isArchived } = useTournament();
  const [shifts, setShifts] = useState<TournamentShift[] | null>(null);
  // Only competition days can hold shifts — a cosmetic track has no range to
  // validate against, so it never appears in the filter or the panel.
  const [tracks, setTracks] = useState<TournamentTrack[]>([]);
  // Fetched once so the panel's Events section can filter locally instead of
  // a round-trip per shift.
  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [trackFilter, setTrackFilter] = useState<string>(ALL_TRACKS);
  const [creatingNew, setCreatingNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TournamentShift | null>(null);

  const {
    focusedId, setPanelDirty, focusItem, clearFocus, startExternalFlow, getPrevNext,
  } = usePanelSelection({ onClearExternal: () => setCreatingNew(false) });

  // Stable identity: it's a dependency of the layout-panel effect below, and
  // a fresh closure each render would re-register the panel every render.
  const clearCreatingNew = useCallback(() => {
    setCreatingNew(false);
    setPanelDirty(false);
  }, [setPanelDirty]);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId)
      .then(setShifts)
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load shifts.");
        setShifts([]);
      });
    tournamentEventsApi.list(tournamentId).then(setEvents).catch(() => setEvents([]));
    tournamentTracksApi.list(tournamentId, { public: true })
      .then((all) => setTracks(all.filter((t) => t.is_primary)))
      .catch(() => setTracks([]));
  }, [tournamentId]);

  const trackName = useCallback(
    (trackId: number) => tracks.find((t) => t.id === trackId)?.name ?? "—",
    [tracks],
  );

  const visibleShifts = useMemo(() => {
    const list = (shifts ?? []).filter(
      (s) => trackFilter === ALL_TRACKS || s.track_id === Number(trackFilter),
    );
    return [...list].sort((a, b) => a.start.localeCompare(b.start));
  }, [shifts, trackFilter]);

  const { hasPrev, hasNext, prevId, nextId } = getPrevNext(visibleShifts, (s) => s.id);

  const handleSaved = useCallback((saved: TournamentShift) => {
    setShifts((prev) => {
      const list = prev ?? [];
      return list.some((s) => s.id === saved.id)
        ? list.map((s) => (s.id === saved.id ? saved : s))
        : [...list, saved];
    });
  }, []);

  const handleDeleted = useCallback((id: number) => {
    setShifts((prev) => (prev ?? []).filter((s) => s.id !== id));
  }, []);

  // An event's shift set changed from inside the panel. Both lists are kept
  // locally, so the shifts' own event_count has to be recomputed alongside —
  // it's what the delete-confirm warning counts.
  const handleEventUpdated = useCallback((updated: TournamentEvent) => {
    setEvents((prev) => {
      const before = (prev ?? []).find((e) => e.id === updated.id);
      const next = (prev ?? []).map((e) => (e.id === updated.id ? updated : e));
      const beforeIds = new Set((before?.shifts ?? []).map((s) => s.id));
      const afterIds = new Set(updated.shifts.map((s) => s.id));
      setShifts((cur) => (cur ?? []).map((s) => {
        if (beforeIds.has(s.id) && !afterIds.has(s.id)) return { ...s, event_count: Math.max(0, s.event_count - 1) };
        if (!beforeIds.has(s.id) && afterIds.has(s.id)) return { ...s, event_count: s.event_count + 1 };
        return s;
      }));
      return next;
    });
  }, []);

  const { setPanel, clearPanel } = useSetLayoutPanel();

  // The editor doesn't render here — it's pushed into the layout shell's
  // docked slot so the panel is a sibling of <main> and shrinks it, leaving
  // the table clickable.
  useEffect(() => {
    if (events === null) return;
    const locked = !canManageEvents || isArchived;

    if (creatingNew) {
      setPanel(
        <ShiftPanel
          tournamentId={tournamentId}
          shift={null}
          tracks={tracks}
          events={events}
          // A tab filtered to one track creates shifts on it — the filter is
          // already the TD saying which day they're working on.
          defaultTrackId={trackFilter === ALL_TRACKS ? (tracks.length === 1 ? tracks[0].id : null) : Number(trackFilter)}
          locked={locked}
          onClose={clearCreatingNew}
          onDirtyChange={setPanelDirty}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onEventUpdated={handleEventUpdated}
        />,
        SHIFT_PANEL_WIDTH,
      );
      return;
    }

    if (focusedId !== null) {
      const shift = (shifts ?? []).find((s) => s.id === focusedId);
      if (!shift) { clearFocus(); return; }
      // Keyed on the id so clicking another row remounts the panel — its
      // draft is seeded from props via useState, which wouldn't re-read.
      setPanel(
        <ShiftPanel
          key={shift.id}
          tournamentId={tournamentId}
          shift={shift}
          tracks={tracks}
          events={events}
          locked={locked}
          onClose={clearFocus}
          onDirtyChange={setPanelDirty}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onEventUpdated={handleEventUpdated}
          onPrev={() => prevId !== null && focusItem(prevId)}
          onNext={() => nextId !== null && focusItem(nextId)}
          hasPrev={hasPrev}
          hasNext={hasNext}
        />,
        SHIFT_PANEL_WIDTH,
      );
      return;
    }

    clearPanel();
  }, [
    creatingNew, focusedId, shifts, events, tracks, trackFilter, tournamentId,
    canManageEvents, isArchived, prevId, nextId, hasPrev, hasNext,
    focusItem, clearFocus, clearCreatingNew, setPanelDirty,
    handleSaved, handleDeleted, handleEventUpdated, setPanel, clearPanel,
  ]);

  // Unmount only (e.g. switching away from this tab) — the panel belongs to
  // the layout, so leaving without this would strand it there.
  useEffect(() => clearPanel, [clearPanel]);

  if (shifts === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const canEdit = canManageEvents && !isArchived;
  // Blocked while the panel is dirty and clears whatever else is open —
  // otherwise this silently replaces an in-progress edit with a blank draft.
  const addShift = () => startExternalFlow(() => setCreatingNew(true));

  return (
    <div>
      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
        {/* Only shown with more than one competition day — with a single
            track every shift is on it, and the filter would be a no-op. */}
        {tracks.length > 1 ? (
          <ButtonGroup
            options={[{ value: ALL_TRACKS, label: "All" }, ...tracks.map((t) => ({ value: String(t.id), label: t.name }))]}
            value={trackFilter}
            onChange={setTrackFilter}
          />
        ) : <span />}
        {canEdit && shifts.length > 0 && (
          <Button type="button" variant="primary" size="md" onClick={addShift}>
            <IconPlus size={14} /> Add shift
          </Button>
        )}
      </div>

      {visibleShifts.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconCalendar size={28} />}
            title={shifts.length === 0 ? "No shifts yet" : "No shifts on this track"}
            description="Shifts are time windows you can attach to events, like &ldquo;Morning — 8am to noon&rdquo;. Each one belongs to a competition day."
            action={canEdit ? (
              <Button type="button" variant="primary" size="sm" onClick={addShift}>
                <IconPlus size={12} /> Add shift
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <div style={{
            display: "grid", gridTemplateColumns: SHIFT_ROW_COLUMNS, gap: "10px",
            padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
          }}>
            <span>Shifts — {visibleShifts.length}</span>
            <span>Track</span>
            <span>Day</span>
            <span>Start</span>
            <span>End</span>
            <span style={{ textAlign: "center" }}>Events</span>
            <span style={{ textAlign: "center" }}>Actions</span>
          </div>

          {visibleShifts.map((shift, i) => (
            <ShiftRow
              key={shift.id}
              shift={shift}
              trackName={trackName(shift.track_id)}
              isLast={i === visibleShifts.length - 1}
              focused={focusedId === shift.id}
              canEdit={canEdit}
              onClick={() => focusItem(shift.id)}
              onDelete={() => setDeleteTarget(shift)}
            />
          ))}
        </Card>
      )}

      {deleteTarget && (
        <DeleteShiftModal
          tournamentId={tournamentId}
          shift={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            handleDeleted(deleteTarget.id);
            // The panel is showing the row that just went away.
            if (focusedId === deleteTarget.id) clearFocus();
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

// Read-only: every edit, including delete, happens in the panel. A row that
// both previews and edits meant two ways to change the same thing, and only
// one of them could show a shift's events.
function ShiftRow({ shift, trackName, isLast, focused, canEdit, onClick, onDelete }: {
  shift: TournamentShift;
  trackName: string;
  isLast: boolean;
  focused: boolean;
  canEdit: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        display: "grid", gridTemplateColumns: SHIFT_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: focused ? "var(--color-accent-subtle)" : hovered ? "var(--color-bg)" : "transparent",
        cursor: "pointer",
        transition: "background 100ms ease",
      }}
    >
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>{shift.label}</span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {trackName}
      </span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {formatDayLabel(toDateInput(shift.start))}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {formatTimeOfDay(toTimeInput(shift.start))}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {formatTimeOfDay(toTimeInput(shift.end))}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center" }}>
        {shift.event_count}
      </span>
      {/* Edit is the same thing clicking the row does — spelled out so the
          row's one action isn't invisible. Delete keeps its own confirm. */}
      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
        <Button type="button" variant="secondary" size="sm" iconOnly title="Edit shift" onClick={onClick}>
          <IconEdit size={13} />
        </Button>
        {canEdit && (
          <Button type="button" variant="secondary" size="sm" iconOnly title="Delete shift" onClick={onDelete}>
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        )}
      </div>
    </div>
  );
}
