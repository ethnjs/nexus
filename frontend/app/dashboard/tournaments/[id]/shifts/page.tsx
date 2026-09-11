"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  tournamentShiftsApi, tournamentEventsApi, tournamentTracksApi, ApiError,
  TournamentEvent, TournamentShift, TournamentTrack,
} from "@/lib/api";
import { formatTimeOfDay, toTimeInput } from "@/lib/timeFormat";
import { useTournament } from "@/lib/useTournament";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { useInitialPanelId, usePanelUrlSync } from "@/lib/usePanelUrl";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PENDING_TRACK_NOTE, PendingTrackBanner } from "@/components/tournament/PendingTrackBanner";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShiftPanel, SHIFT_PANEL_WIDTH } from "@/components/tournament/events/ShiftPanel";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import { DeleteShiftModal } from "@/components/tournament/events/DeleteShiftModal";
import { MassShiftEditor, MASS_SHIFT_EDITOR_WIDTH } from "@/components/tournament/events/MassShiftEditor";
import { Checkbox } from "@/components/ui/Checkbox";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { useToast } from "@/lib/useToast";
import { IconPlus, IconCalendar, IconEdit, IconTrash, IconLock, IconCopy } from "@/components/ui/Icons";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";

// Select / Label / Track / Start / End / Events / Actions. The select track is
// always present (0px when off) so its width can animate, like the events table.
function shiftGridColumns(selectMode: boolean) {
  return `${selectMode ? "28px" : "0px"} 1.6fr 1fr 0.8fr 0.8fr 70px 80px`;
}

const ALL_TRACKS = "all";

// Its own route rather than a tab under Events: a shift belongs to a track,
// not to an event, and it is the thing availability is collected against —
// it outranks being a sub-view of the event catalog.
export default function ShiftsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageEvents = isAdmin || isOwner || hasPermission("manage_events");

  const { isArchived } = useTournament();
  const [shifts, setShifts] = useState<TournamentShift[] | null>(null);
  // Only competition days can hold shifts — a cosmetic track has no range to
  // validate against, so it never appears in the filter or the panel.
  // Pending-delete days stay in: their shifts still exist and still need a
  // name, and the panel filters them out of its own picker.
  const [tracks, setTracks] = useState<TournamentTrack[]>([]);
  // Fetched once so the panel's Events section can filter locally instead of
  // a round-trip per shift.
  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [trackFilter, setTrackFilter] = useState<string>(ALL_TRACKS);
  const [creatingNew, setCreatingNew] = useState(false);
  // Bumped per Add click and used as the create panel's key. After a save the
  // panel stays open on the new shift, so without a remount Add is a no-op.
  const [createKey, setCreateKey] = useState(0);
  // One shift from a row's trash button, or the whole selection from the toolbar.
  const [deleteTargets, setDeleteTargets] = useState<TournamentShift[] | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const { show } = useToast();
  // Bumped when the tab regains focus, so collaborators' changes show up.
  const [refreshKey, setRefreshKey] = useState(0);
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1));

  const initialShiftId = useInitialPanelId("shift");
  const {
    focusedId, selectMode, selectedIds, massPanelOpen, panelDirty,
    setPanelDirty, focusItem, clearFocus, startExternalFlow, getPrevNext,
    toggleSelectMode, toggleSelected, toggleSelectAll, openMassPanel, clearSelection, forgetItem,
  } = usePanelSelection({
    onClearExternal: () => setCreatingNew(false),
    initialFocusedId: initialShiftId,
  });
  // The URL mirrors whichever shift's panel is open, so a refresh comes back
  // to it.
  usePanelUrlSync("shift", focusedId);

  // Stable identity: it's a dependency of the layout-panel effect below, and
  // a fresh closure each render would re-register the panel every render.
  const clearCreatingNew = useCallback(() => {
    setCreatingNew(false);
    setPanelDirty(false);
  }, [setPanelDirty]);

  // Refetched after any write that could have been the last thing holding a
  // pending track: the backend purges it the moment its final reference is
  // repointed, so a cached catalog would keep offering a track that is gone
  // and keep the warning banner up after the work is done.
  const loadTracks = useCallback(() => {
    tournamentTracksApi.list(tournamentId, { public: true })
      .then((all) => setTracks(all.filter((t) => t.is_primary)))
      .catch(() => setTracks([]));
  }, [tournamentId]);

  // Gated on the permission, and re-run when it lands: the table used to be a
  // child that only mounted once the check had passed, so unmounted meant
  // unfetched. Inlined, this effect runs on the first render too — while
  // membership is still loading and the answer is a provisional false.
  useEffect(() => {
    if (!canManageEvents) return;
    tournamentShiftsApi.list(tournamentId)
      .then(setShifts)
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load shifts.");
        setShifts([]);
      });
    tournamentEventsApi.list(tournamentId).then(setEvents).catch(() => setEvents([]));
    loadTracks();
  }, [tournamentId, canManageEvents, loadTracks, refreshKey]);

  const trackById = useCallback(
    (trackId: number) => tracks.find((t) => t.id === trackId),
    [tracks],
  );

  const visibleShifts = useMemo(() => {
    const list = (shifts ?? []).filter(
      (s) => trackFilter === ALL_TRACKS || s.track_id === Number(trackFilter),
    );
    return [...list].sort((a, b) => a.start.localeCompare(b.start));
  }, [shifts, trackFilter]);

  const selectedShifts = useMemo(
    () => (shifts ?? []).filter((s) => selectedIds.has(s.id)),
    [shifts, selectedIds],
  );

  const { hasPrev, hasNext, prevId, nextId } = getPrevNext(visibleShifts, (s) => s.id);

  const shiftTracks = useMemo(() => {
    const ids = new Set((shifts ?? []).map((s) => s.track_id));
    return tracks.filter((t) => ids.has(t.id));
  }, [shifts, tracks]);

  // Lists, so a mass edit or bulk delete reloads tracks once rather than per row.
  const handleSaved = useCallback((saved: TournamentShift[]) => {
    const byId = new Map(saved.map((s) => [s.id, s]));
    setShifts((prev) => {
      const list = prev ?? [];
      const known = new Set(list.map((s) => s.id));
      return [...list.map((s) => byId.get(s.id) ?? s), ...saved.filter((s) => !known.has(s.id))];
    });
    // Moving a shift off a pending track can be what purges it.
    loadTracks();
  }, [loadTracks]);

  // forgetItem drops a gone row out of the selection and closes a panel on it.
  const handleDeleted = useCallback((ids: number[]) => {
    const gone = new Set(ids);
    setShifts((prev) => (prev ?? []).filter((s) => !gone.has(s.id)));
    forgetItem(ids);
    loadTracks();
  }, [loadTracks, forgetItem]);

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
    // Detaching a shift from the last event on a pending track can purge it.
    loadTracks();
  }, [loadTracks]);

  const { setPanel, clearPanel } = useSetLayoutPanel();

  // The editor doesn't render here — it's pushed into the layout shell's
  // docked slot so the panel is a sibling of <main> and shrinks it, leaving
  // the table clickable.
  useEffect(() => {
    // Same reason as the fetch above — an effect on this page now runs even
    // when the render below is the no-access card, and that page has no
    // panel to dock.
    if (!canManageEvents) return;
    if (events === null) return;
    const locked = !canManageEvents || isArchived;

    if (creatingNew) {
      setPanel(
        <ShiftPanel
          key={`new-${createKey}`}
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
          onSaved={(s) => handleSaved([s])}
          onDeleted={(id) => handleDeleted([id])}
          onEventUpdated={handleEventUpdated}
        />,
        SHIFT_PANEL_WIDTH,
      );
      return;
    }

    if (focusedId !== null) {
      // Not loaded is not the same as not there — see the same guard in
      // the events page. `shifts` is its own fetch, so the guard above (events)
      // does not cover it.
      if (shifts === null) return;
      const shift = shifts.find((s) => s.id === focusedId);
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
          onSaved={(s) => handleSaved([s])}
          onDeleted={(id) => handleDeleted([id])}
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

    // Select mode: one shift gets the full panel, several get the mass editor.
    if (massPanelOpen && selectedShifts.length === 1) {
      const shift = selectedShifts[0];
      setPanel(
        <ShiftPanel
          key={shift.id}
          tournamentId={tournamentId}
          shift={shift}
          tracks={tracks}
          events={events}
          locked={locked}
          onClose={clearSelection}
          onDirtyChange={setPanelDirty}
          onSaved={(s) => handleSaved([s])}
          onDeleted={(id) => handleDeleted([id])}
          onEventUpdated={handleEventUpdated}
        />,
        SHIFT_PANEL_WIDTH,
      );
      return;
    }

    if (massPanelOpen && selectedShifts.length > 1) {
      setPanel(
        <MassShiftEditor
          tournamentId={tournamentId}
          shifts={selectedShifts}
          tracks={tracks}
          onClose={clearSelection}
          onDirtyChange={setPanelDirty}
          onSaved={handleSaved}
        />,
        MASS_SHIFT_EDITOR_WIDTH,
      );
      return;
    }

    clearPanel();
  }, [
    creatingNew, createKey, focusedId, massPanelOpen, selectedShifts, clearSelection,
    shifts, events, tracks, trackFilter, tournamentId,
    canManageEvents, isArchived, prevId, nextId, hasPrev, hasNext,
    focusItem, clearFocus, clearCreatingNew, setPanelDirty,
    handleSaved, handleDeleted, handleEventUpdated, setPanel, clearPanel,
  ]);

  // Unmount only (e.g. switching away from this tab) — the panel belongs to
  // the layout, so leaving without this would strand it there.
  useEffect(() => clearPanel, [clearPanel]);

  // Every early return below sits after every hook above, which is the whole
  // constraint the flattening had to respect: a gate that returned before
  // them would change the hook order between renders.
  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageEvents) {
    return (
      <div>
        <PageHeader heading="Shifts" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage events permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (shifts === null) {
    return (
      <div>
        <PageHeader heading="Shifts" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const canEdit = canManageEvents && !isArchived;
  // Blocked while the panel is dirty and clears whatever else is open —
  // otherwise this silently replaces an in-progress edit with a blank draft.
  const addShift = () => startExternalFlow(() => {
    setCreatingNew(true);
    setCreateKey((k) => k + 1);
  });

  // Exact copies with "(copy)" on the label — same track and times, so the TD
  // edits the copies rather than re-entering everything.
  async function duplicateSelected() {
    setDuplicating(true);
    const outcomes = await Promise.allSettled(selectedShifts.map((s) => tournamentShiftsApi.create(tournamentId, {
      track_id: s.track_id, label: `${s.label} (copy)`, start: s.start, end: s.end,
    })));
    const created = outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
    if (created.length > 0) handleSaved(created);
    const failed = outcomes.length - created.length;
    if (failed > 0) show(`Duplicated ${created.length}, ${failed} failed.`, "error");
    else show(`Duplicated ${created.length} shift${created.length === 1 ? "" : "s"}.`);
    setDuplicating(false);
  }

  return (
    <div>
      <PageHeader heading="Shifts" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {/* Only the tracks these shifts are actually on. */}
      <PendingTrackBanner tracks={shiftTracks} subject="shifts" />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
        {/* Only shown with more than one competition day — with a single
            track every shift is on it, and the filter would be a no-op. */}
        {/* Live tracks only — `tracks` keeps pending-delete ones so their
            shifts can still name them, but they are not a view to switch to. */}
        {tracks.filter((t) => !t.is_archived).length > 1 ? (
          <ButtonGroup
            options={[
              { value: ALL_TRACKS, label: "All" },
              ...tracks.filter((t) => !t.is_archived).map((t) => ({ value: String(t.id), label: t.name })),
            ]}
            value={trackFilter}
            onChange={setTrackFilter}
          />
        ) : <span />}
        {canEdit && shifts.length > 0 && (
          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              type="button" variant={selectMode ? "primary" : "secondary"} size="md"
              onClick={toggleSelectMode}
              disabled={panelDirty}
              title={panelDirty ? "Save or discard your changes first" : undefined}
            >
              Select
            </Button>
            <Button type="button" variant="primary" size="md" onClick={addShift}>
              <IconPlus size={14} /> Add shift
            </Button>
          </div>
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
            display: "grid", gridTemplateColumns: shiftGridColumns(selectMode), gap: "10px",
            transition: "grid-template-columns 200ms ease",
            padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
          }}>
            <span
              style={{
                display: "flex", justifyContent: "center", overflow: "hidden",
                opacity: selectMode ? 1 : 0, pointerEvents: selectMode ? "auto" : "none",
                transition: "opacity 150ms ease",
              }}
              title={panelDirty ? "Save or discard your changes first" : undefined}
            >
              <Checkbox
                checked={visibleShifts.length > 0 && visibleShifts.every((s) => selectedIds.has(s.id))}
                locked={panelDirty}
                onChange={(checked) => toggleSelectAll(visibleShifts.map((s) => s.id), checked)}
              />
            </span>
            <span>Shifts — {visibleShifts.length}</span>
            <span>Track</span>
            <span>Start</span>
            <span>End</span>
            <span style={{ textAlign: "center" }}>Events</span>
            <span style={{ textAlign: "center" }}>Actions</span>
          </div>

          {visibleShifts.map((shift, i) => (
            <ShiftRow
              key={shift.id}
              shift={shift}
              track={trackById(shift.track_id)}
              isLast={i === visibleShifts.length - 1}
              focused={focusedId === shift.id}
              canEdit={canEdit}
              onClick={() => focusItem(shift.id)}
              onDelete={() => setDeleteTargets([shift])}
              selectMode={selectMode}
              selected={selectedIds.has(shift.id)}
              selectionLocked={panelDirty}
              onToggleSelect={() => toggleSelected(shift.id)}
            />
          ))}
        </Card>
      )}

      {/* Stays up while boxes are checked; Edit is what opens a panel. */}
      <SelectionBar
        visible={selectMode && !massPanelOpen}
        count={selectedIds.size}
        onEdit={openMassPanel}
        onCancel={toggleSelectMode}
        actions={
          <>
            <Button
              type="button" variant="secondary" size="sm" iconOnly title="Duplicate selected"
              disabled={selectedIds.size === 0} loading={duplicating} onClick={duplicateSelected}
            >
              <IconCopy size={13} />
            </Button>
            <Button
              type="button" variant="secondary" size="sm" iconOnly title="Delete selected"
              disabled={selectedIds.size === 0} onClick={() => setDeleteTargets(selectedShifts)}
            >
              <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
            </Button>
          </>
        }
      />

      {deleteTargets && (
        <DeleteShiftModal
          tournamentId={tournamentId}
          shifts={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

// Read-only: every edit, including delete, happens in the panel. A row that
// both previews and edits meant two ways to change the same thing, and only
// one of them could show a shift's events.
function ShiftRow({
  shift, track, isLast, focused, canEdit, onClick, onDelete,
  selectMode, selected, selectionLocked, onToggleSelect,
}: {
  shift: TournamentShift;
  /** Undefined only while the catalog is still loading. */
  track: TournamentTrack | undefined;
  isLast: boolean;
  focused: boolean;
  canEdit: boolean;
  onClick: () => void;
  onDelete: () => void;
  selectMode: boolean;
  selected: boolean;
  /** Open panel has unsaved changes — focus and selection are frozen until it resolves. */
  selectionLocked: boolean;
  onToggleSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // In select mode a click toggles the box; otherwise it opens the panel.
  const highlighted = selectMode ? selected : focused;
  const lockedTitle = selectionLocked ? "Save or discard your changes first" : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={selectionLocked ? undefined : selectMode ? onToggleSelect : onClick}
      title={lockedTitle}
      style={{
        display: "grid", gridTemplateColumns: shiftGridColumns(selectMode), alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: track?.is_archived && !highlighted
          ? (hovered ? "var(--color-warning-subtle-hover)" : "var(--color-warning-subtle)")
          : highlighted
            ? "var(--color-accent-subtle)"
            : hovered ? "var(--color-bg)" : "transparent",
        cursor: selectionLocked ? "not-allowed" : "pointer",
        transition: "background 100ms ease, grid-template-columns 200ms ease",
      }}
    >
      <span
        style={{
          display: "flex", justifyContent: "center", overflow: "hidden",
          opacity: selectMode ? 1 : 0, pointerEvents: selectMode ? "auto" : "none",
          transition: "opacity 150ms ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} locked={selectionLocked} onChange={onToggleSelect} />
      </span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>{shift.label}</span>
      <span style={{ display: "flex", minWidth: 0 }}>
        <Badge
          variant={track?.is_archived ? "warning" : "default"}
          title={track?.is_archived ? PENDING_TRACK_NOTE : undefined}
        >
          {track?.name ?? "—"}
        </Badge>
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
        <Button type="button" variant="secondary" size="sm" iconOnly disabled={selectionLocked} title={lockedTitle ?? "Edit shift"} onClick={onClick}>
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
