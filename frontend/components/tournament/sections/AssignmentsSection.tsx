"use client";

/**
 * One member's staffing, laid out the way the assignments board lays out one
 * event's — but read the other way round. There, a row is an event and the
 * chips are people; here the row is this member and the chips are events.
 *
 * A timeline per competition day, because a shift belongs to a track and two
 * days are two schedules rather than one long one. A cosmetic track (Test
 * Writing) has no shifts by construction, so it gets a column in the no-shift
 * area instead of a timeline of its own.
 */
import {
  useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent,
} from "react";
import { useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";

import { useRegisterBoardDnd } from "@/components/assignments/BoardDnd";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { FieldValue } from "@/components/profile/PanelField";
import { Button } from "@/components/ui/Button";
import { IconPlus, IconWarning, IconX } from "@/components/ui/Icons";
import { PillMenu } from "@/components/ui/PillMenu";
import { Popover } from "@/components/ui/Popover";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ApiError, assignmentsApi, tournamentEventsApi,
  type Assignment, type MembershipView, type Role, type TournamentEvent,
  type TournamentShift, type TournamentTrack,
} from "@/lib/api";
import {
  buildLanes, laneFlags, roleSummary, sameRole,
  type AssignmentRole, type Lane,
} from "@/lib/assignments/lanes";
import { assignmentFlags, memberFacts, type Flag } from "@/lib/assignments/flags";
import { eventName } from "@/lib/eventDisplay";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { useToast } from "@/lib/useToast";

interface AssignmentsSectionProps {
  tournamentId: number;
  membershipId: number;
  /** The whole member: their assignments are what this draws, and their
   *  availability is both the shading and half of what the warnings check. */
  member: MembershipView;
  /** Every shift the tournament offers. The timeline shows all of a visible
   *  track's shifts, not only the ones this member is on or free for. */
  allShifts: TournamentShift[];
  tracks: TournamentTrack[];
  roleCatalog: Role[];
  /** Tracks the viewer has turned off in the panel's display config. */
  hiddenTrackIds: Set<number>;
  /** The "Availability shading" field of this section. */
  showAvailability: boolean;
  locked: boolean;
  /** Fires after a write lands, so the panel can re-read the member. */
  onChanged?: () => void;
}

/** A bar here is one event, not one person — the inverse of the board's key. */
function laneKeyOf(assignment: Assignment) {
  return String(assignment.event.id);
}

export function AssignmentsSection({
  tournamentId, membershipId, member, allShifts, tracks,
  roleCatalog, hiddenTrackIds, showAvailability, locked, onChanged,
}: AssignmentsSectionProps) {
  const { show } = useToast();
  // Seeded from the payload and edited locally, so a drag lands instantly
  // rather than after a round trip. The parent re-reads on onChanged, which
  // re-seeds this.
  const assignments = useMemo(() => member.assignments ?? [], [member.assignments]);
  const [rows, setRows] = useState<Assignment[]>(assignments);
  useEffect(() => { setRows(assignments) }, [assignments]);

  // The event catalog behind the Add button. Fetched here rather than passed:
  // it is this section's own picker, and no other part of the panel wants it.
  const [catalog, setCatalog] = useState<TournamentEvent[] | null>(null);
  const [pending, setPending] = useState<TournamentEvent | null>(null);

  useEffect(() => {
    if (locked) return;
    let current = true;
    tournamentEventsApi.list(tournamentId)
      .then((data) => { if (current) setCatalog(data) })
      .catch(() => { if (current) setCatalog([]) });
    return () => { current = false };
  }, [tournamentId, locked]);

  const visibleTracks = useMemo(
    () => tracks.filter((track) => !track.is_archived && !hiddenTrackIds.has(track.id)),
    [tracks, hiddenTrackIds],
  );

  // Only competition days have shifts to lay a timeline over, and only the
  // ones that actually hold some — a primary track with an empty schedule
  // would draw an axis with no columns under it.
  const dayTracks = useMemo(() => visibleTracks
    .filter((track) => track.is_primary)
    .map((track) => ({
      track,
      shifts: allShifts
        .filter((shift) => shift.track_id === track.id)
        .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id),
    }))
    .filter((day) => day.shifts.length > 0), [visibleTracks, allShifts]);

  const workstreams = useMemo(
    () => visibleTracks.filter((track) => !track.is_primary),
    [visibleTracks],
  );

  const availableShiftIds = useMemo(
    () => new Set((member.availability ?? []).map((slot) => slot.shift_id)),
    [member.availability],
  );

  // The board's own warnings, against this one member: double-bookings and
  // assignments outside what they said they could work.
  const flagsFor = useMemo(() => {
    // The rows as they are *now*, not the payload's — a chip just dragged
    // onto a shift should flag the clash it creates, not the one it left.
    const facts = memberFacts(member, rows);
    return (assignment: Assignment) => assignmentFlags(assignment, facts);
  }, [member, rows]);

  // ── writes ──────────────────────────────────────────────────────────────
  // Every one of these is a small diff against the lane's current rows rather
  // than a delete-and-recreate: the same reason the board diffs, which is
  // that recreating a cell races the delete of the row already holding it.

  async function runWrite(work: () => Promise<void>, previous: Assignment[]) {
    try {
      await work();
      onChanged?.();
    } catch (err) {
      setRows(previous);
      show(err instanceof ApiError ? err.message : "That change didn't save.", "error");
    }
  }

  /** Place `event` on exactly `shifts` of `track` — the one write every drag,
   *  drop and resize in this section comes down to. */
  function placeEvent(
    eventId: number, track: TournamentTrack, shifts: TournamentShift[], role: AssignmentRole,
  ) {
    const previous = rows;
    const lane = rows.filter((row) => row.event.id === eventId);
    const wanted = shifts.length > 0 ? shifts.map((s) => s.id) : [null];
    const keep = new Map<string, Assignment>();
    for (const row of lane) {
      const key = `${row.shift?.id ?? "none"}|${row.track.id}`;
      keep.set(key, row);
    }

    const kept: Assignment[] = [];
    const missing: (number | null)[] = [];
    for (const shiftId of wanted) {
      const found = keep.get(`${shiftId ?? "none"}|${track.id}`);
      if (found) kept.push(found);
      else missing.push(shiftId);
    }
    const keptIds = new Set(kept.map((row) => row.id));
    const removed = lane.filter((row) => !keptIds.has(row.id));
    if (missing.length === 0 && removed.length === 0) return;

    // Optimistic: the kept rows stay, the removed ones go, and the new cells
    // appear once the server answers with real ids.
    setRows((current) => current.filter((row) => !removed.some((r) => r.id === row.id)));

    runWrite(async () => {
      for (const shiftId of missing) {
        await assignmentsApi.create(tournamentId, {
          tournament_event_id: eventId,
          membership_id: membershipId,
          role_id: role.id!,
          tournament_shift_id: shiftId,
          tournament_track_id: shiftId === null ? track.id : null,
        });
      }
      for (const row of removed) await assignmentsApi.delete(tournamentId, row.id);
    }, previous);
  }

  function removeLane(lane: Lane) {
    const previous = rows;
    const ids = new Set(lane.assignments.map((row) => row.id));
    setRows((current) => current.filter((row) => !ids.has(row.id)));
    runWrite(async () => {
      for (const row of lane.assignments) await assignmentsApi.delete(tournamentId, row.id);
    }, previous);
  }

  /** Swap the lane's role. A PATCH per row, not a rebuild: the cells don't
   *  move, only what they say — and the route grants the role if this member
   *  doesn't hold it yet. */
  function pickRole(lane: Lane, role: AssignmentRole) {
    if (lane.roles.length === 1 && sameRole(lane.roles[0], role)) return;
    const previous = rows;
    const ids = new Set(lane.assignments.map((row) => row.id));
    setRows((current) => current.map((row) => (ids.has(row.id) ? { ...row, role } : row)));
    runWrite(async () => {
      for (const row of lane.assignments) {
        await assignmentsApi.update(tournamentId, row.id, { role_id: role.id! });
      }
    }, previous);
  }

  function defaultRoleFor(track: TournamentTrack): AssignmentRole | null {
    if (track.default_role_id === null) return null;
    const role = roleCatalog.find((r) => r.id === track.default_role_id);
    return role ? { id: role.id, label: role.label } : null;
  }

  // ── drag ────────────────────────────────────────────────────────────────
  function handleDragEnd({ active, over }: DragEndEvent) {
    const target = over?.data.current;
    const source = active.data.current;
    if (!target || !source || locked) return;
    if (target.kind !== "panel-shift" && target.kind !== "panel-track") return;
    if (source.kind !== "panel-event" && source.kind !== "panel-pending") return;

    const track = tracks.find((t) => t.id === target.trackId);
    if (!track) return;
    const shifts = target.kind === "panel-shift"
      ? [allShifts.find((s) => s.id === target.shiftId)!]
      : [];

    const eventId = source.eventId as number;
    const existing = rows.filter((row) => row.event.id === eventId);
    const role = existing[0]?.role ?? defaultRoleFor(track);
    if (!role) {
      show(`No default role set for ${track.name} — set one in tournament settings first.`, "error");
      return;
    }
    placeEvent(eventId, track, shifts, role);
    setPending(null);
  }

  useRegisterBoardDnd("member-panel-assignments", {
    onDragEnd: handleDragEnd,
    renderOverlay: (activeId) => {
      if (!activeId.startsWith("panel-")) return null;
      const eventId = Number(activeId.split(":")[1]);
      const name = rows.find((row) => row.event.id === eventId)?.event.name
        ?? (catalog ?? []).find((e) => e.id === eventId)?.name
        ?? pending?.name;
      return name ? <DragLabel label={name} /> : null;
    },
  });

  const assigned = new Set(rows.map((row) => row.event.id));
  const pickable = (catalog ?? []).filter((event) => !assigned.has(event.id));

  return (
    <ProfileCard>
      <SectionHeading title="Assignments">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {!locked && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm">
                    <IconPlus size={12} /> Add event
                  </Button>
                }
                items={pickable}
                getKey={(event) => event.id}
                renderLabel={(event) => eventNameWithDivision(event)}
                getSearchText={(event) => eventNameWithDivision(event)}
                searchable
                onSelect={(event) => setPending(event)}
                emptyMessage={catalog === null ? "Loading…" : "Every event is already here"}
                width={280}
                align="left"
              />
              {/* Picked but not placed. Dropping it is what says which track
                  and shift it is for, which is the thing an assignment row
                  cannot be created without. */}
              {pending && (
                <PendingChip event={pending} onCancel={() => setPending(null)} />
              )}
              {pending && (
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                }}>
                  Drag it onto a shift or a workstream
                </span>
              )}
            </div>
          )}

          {dayTracks.length === 0 && workstreams.length === 0 && (
            <FieldValue muted>No tracks to schedule against</FieldValue>
          )}

          {dayTracks.map(({ track, shifts }) => (
            <DayTimeline
              key={track.id}
              track={track}
              shifts={shifts}
              rows={rows}
              availableShiftIds={availableShiftIds}
              showAvailability={showAvailability}
              roleCatalog={roleCatalog}
              flagsFor={flagsFor}
              locked={locked}
              onPickRole={pickRole}
              onRemove={removeLane}
              onResize={(lane, from, to) => {
                const role = lane.roles[0] ?? defaultRoleFor(track);
                if (role) placeEvent(Number(lane.key), track, shifts.slice(from, to + 1), role);
              }}
            />
          ))}

          {workstreams.length > 0 && (
            <WorkstreamRow
              tracks={workstreams}
              rows={rows}
              roleCatalog={roleCatalog}
              flagsFor={flagsFor}
              locked={locked}
              onPickRole={pickRole}
              onRemove={removeLane}
            />
          )}
        </div>
      </SectionHeading>
    </ProfileCard>
  );
}

function eventNameWithDivision(event: TournamentEvent): string {
  const name = eventName(event);
  return event.division ? `${name} ${event.division}` : name;
}

// ---------------------------------------------------------------------------
// One competition day
// ---------------------------------------------------------------------------
function DayTimeline({
  track, shifts, rows, availableShiftIds, showAvailability, roleCatalog, flagsFor,
  locked, onPickRole, onRemove, onResize,
}: {
  track: TournamentTrack;
  shifts: TournamentShift[];
  rows: Assignment[];
  availableShiftIds: Set<number>;
  showAvailability: boolean;
  roleCatalog: Role[];
  flagsFor: (a: Assignment) => Flag[];
  locked: boolean;
  onPickRole: (lane: Lane, role: AssignmentRole) => void;
  onRemove: (lane: Lane) => void;
  onResize: (lane: Lane, from: number, to: number) => void;
}) {
  const shiftIds = shifts.map((s) => s.id);
  // Only this track's rows: an event can be staffed on two days, and each
  // day's timeline speaks for its own.
  const mine = rows.filter((row) => row.track.id === track.id && row.shift !== null);
  const { lanes } = buildLanes(mine, shiftIds, laneKeyOf);
  const columns = shifts.length;
  const gridColumns = `repeat(${columns}, minmax(0, 1fr))`;
  const boundaries = [shifts[0].start, ...shifts.map((s) => s.end)];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.04em", color: "var(--color-text-secondary)",
      }}>
        {track.name}
        <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>
          {track.start_date ? ` · ${formatDayLabel(toDateInput(shifts[0].start))}` : ""}
        </span>
      </span>

      {/* Times and shift names share one line — they name the same axis, and a
          name is centred in its column while a time sits on the divider
          between two, so each falls in the other's gap. */}
      <div style={{
        position: "relative", display: "grid", gridTemplateColumns: gridColumns,
        borderBottom: "1px solid var(--color-border)", paddingBottom: "3px",
      }}>
        {boundaries.map((moment, i) => (
          <span
            key={i}
            style={{
              position: "absolute", left: `${(i / columns) * 100}%`, top: "50%",
              transform: i === columns ? "translate(-100%, -50%)" : "translateY(-50%)",
              paddingLeft: i === columns ? 0 : "3px",
              paddingRight: i === columns ? "3px" : 0,
              fontFamily: "var(--font-sans)", fontSize: "9px",
              color: "var(--color-text-tertiary)", whiteSpace: "nowrap",
            }}
          >
            {formatTime(moment)}
          </span>
        ))}
        {shifts.map((shift) => (
          <span key={shift.id} style={{
            fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 500,
            color: "var(--color-text-secondary)", textAlign: "center",
            padding: "0 4px", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {shift.label}
          </span>
        ))}
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "3px" }}>
        {/* The columns are the drop targets and the availability shading at
            once, drawn once behind the bars so they run the row's full
            height rather than repeating per lane. */}
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: gridColumns }}>
          {shifts.map((shift, i) => (
            <ShiftCell
              key={shift.id}
              shift={shift}
              trackId={track.id}
              first={i === 0}
              available={availableShiftIds.has(shift.id)}
              shade={showAvailability}
              locked={locked}
            />
          ))}
        </div>

        {lanes.length === 0 && (
          <div style={{ position: "relative", padding: "6px 0" }}>
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "11px",
              color: "var(--color-text-tertiary)",
            }}>
              Nothing on this day
            </span>
          </div>
        )}

        {lanes.map((lane) => (
          <div
            key={lane.key}
            data-panel-lane
            style={{ position: "relative", display: "grid", gridTemplateColumns: gridColumns }}
          >
            <EventBar
              lane={lane}
              columns={columns}
              roleCatalog={roleCatalog}
              flagsFor={flagsFor}
              locked={locked}
              onPickRole={onPickRole}
              onRemove={onRemove}
              onResize={onResize}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One shift's cell: the drop target, and the availability shading when it's
 *  turned on. Green and red rather than green and nothing — "didn't say" and
 *  "said no" are the same answer here, which is that staffing them is an
 *  override the flags already warn about. */
function ShiftCell({ shift, trackId, first, available, shade, locked }: {
  shift: TournamentShift;
  trackId: number;
  first: boolean;
  available: boolean;
  shade: boolean;
  locked: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `panel-shift:${shift.id}`,
    data: { kind: "panel-shift", shiftId: shift.id, trackId },
    disabled: locked,
  });
  const shaded = shade
    ? (available ? "var(--color-success-subtle)" : "var(--color-danger-subtle)")
    : "transparent";
  return (
    <div
      ref={setNodeRef}
      style={{
        borderLeft: first ? "none" : "1px solid var(--color-border)",
        background: isOver ? "var(--color-accent-subtle)" : shaded,
        transition: "background 120ms ease",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// The no-shift area: one column per workstream
// ---------------------------------------------------------------------------
function WorkstreamRow({
  tracks, rows, roleCatalog, flagsFor, locked, onPickRole, onRemove,
}: {
  tracks: TournamentTrack[];
  rows: Assignment[];
  roleCatalog: Role[];
  flagsFor: (a: Assignment) => Flag[];
  locked: boolean;
  onPickRole: (lane: Lane, role: AssignmentRole) => void;
  onRemove: (lane: Lane) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}>
        No shift
      </span>
      <div style={{
        display: "grid", gap: "6px",
        gridTemplateColumns: `repeat(${tracks.length}, minmax(0, 1fr))`,
      }}>
        {tracks.map((track) => (
          <WorkstreamColumn
            key={track.id}
            track={track}
            lanes={buildLanes(
              rows.filter((row) => row.shift === null && row.track.id === track.id), [], laneKeyOf,
            ).unpinned}
            roleCatalog={roleCatalog}
            flagsFor={flagsFor}
            locked={locked}
            onPickRole={onPickRole}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

function WorkstreamColumn({
  track, lanes, roleCatalog, flagsFor, locked, onPickRole, onRemove,
}: {
  track: TournamentTrack;
  lanes: Lane[];
  roleCatalog: Role[];
  flagsFor: (a: Assignment) => Flag[];
  locked: boolean;
  onPickRole: (lane: Lane, role: AssignmentRole) => void;
  onRemove: (lane: Lane) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `panel-track:${track.id}`,
    data: { kind: "panel-track", trackId: track.id },
    disabled: locked,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex", flexDirection: "column", gap: "5px", minWidth: 0,
        padding: "5px 6px", borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border)",
        background: isOver ? "var(--color-accent-subtle)" : "transparent",
        minHeight: "48px", transition: "background 120ms ease",
      }}
    >
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
        letterSpacing: "0.04em", color: "var(--color-text-tertiary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {track.name}
      </span>
      {lanes.map((lane) => (
        <EventChip
          key={lane.key}
          lane={lane}
          roleCatalog={roleCatalog}
          flags={laneFlags(lane, flagsFor)}
          locked={locked}
          onPickRole={onPickRole}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

/** A bar on a day's timeline: the chip plus the span it covers. */
function EventBar({
  lane, columns, roleCatalog, flagsFor, locked, onPickRole, onRemove, onResize,
}: {
  lane: Lane;
  columns: number;
  roleCatalog: Role[];
  flagsFor: (a: Assignment) => Flag[];
  locked: boolean;
  onPickRole: (lane: Lane, role: AssignmentRole) => void;
  onRemove: (lane: Lane) => void;
  onResize: (lane: Lane, from: number, to: number) => void;
}) {
  const first = Math.min(...lane.covered);
  const last = Math.max(...lane.covered);
  const [resizing, setResizing] = useState<"start" | "end" | null>(null);

  // A raw pointer drag rather than a dnd-kit draggable, for the same reason
  // the board resizes this way: stretching a bar changes how far it reaches,
  // not where it lives, and routing it through the drag context would make
  // every resize look like a reassignment to the drop targets.
  function startResize(edge: "start" | "end", e: ReactPointerEvent) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const laneEl = handle.closest("[data-panel-lane]");
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const colWidth = rect.width / columns;
    handle.setPointerCapture(e.pointerId);
    setResizing(edge);

    const priorCursor = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";
    let index = edge === "start" ? first : last;

    function move(ev: globalThis.PointerEvent) {
      const raw = Math.floor((ev.clientX - rect.left) / colWidth);
      index = Math.max(0, Math.min(columns - 1, raw));
    }
    function up() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      document.body.style.cursor = priorCursor;
      setResizing(null);
      // Committed once, on release — every write here is an API call, so a
      // commit per pointermove would be a request per pixel.
      const from = edge === "start" ? Math.min(index, last) : first;
      const to = edge === "start" ? last : Math.max(index, first);
      if (from !== first || to !== last) onResize(lane, from, to);
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  return (
    <div style={{ gridColumn: `${first + 1} / ${last + 2}`, minWidth: 0, padding: "0 2px" }}>
      <EventChip
        lane={lane}
        roleCatalog={roleCatalog}
        flags={laneFlags(lane, flagsFor)}
        locked={locked}
        onPickRole={onPickRole}
        onRemove={onRemove}
        onResizeStart={startResize}
        resizingEdge={resizing}
      />
    </div>
  );
}

function EventChip({
  lane, roleCatalog, flags, locked, onPickRole, onRemove, onResizeStart, resizingEdge,
}: {
  lane: Lane;
  roleCatalog: Role[];
  flags: Flag[];
  locked: boolean;
  onPickRole: (lane: Lane, role: AssignmentRole) => void;
  onRemove: (lane: Lane) => void;
  /** Given, the chip grows its own resize edges — no separate handles. */
  onResizeStart?: (edge: "start" | "end", e: ReactPointerEvent) => void;
  resizingEdge?: "start" | "end" | null;
}) {
  const [hovered, setHovered] = useState(false);
  const eventId = lane.assignments[0].event.id;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `panel-event:${eventId}`,
    data: { kind: "panel-event", eventId },
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: "5px",
        padding: "3px 10px", borderRadius: "var(--radius-md)",
        border: `1px solid ${flags.length ? "var(--color-warning)" : "var(--color-border)"}`,
        background: flags.length ? "var(--color-warning-subtle)" : "var(--color-surface)",
        fontSize: "11px", opacity: isDragging ? 0.4 : 1,
        cursor: locked ? "default" : "grab", outline: "none", minWidth: 0,
      }}
    >
      {onResizeStart && !locked && (
        <ResizeGrip edge="start" active={resizingEdge === "start"} onStart={onResizeStart} />
      )}
      <span style={{
        fontFamily: "var(--font-sans)", fontWeight: 500, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
      }}>
        {lane.assignments[0].event.name}
      </span>
      {/* stopPropagation so pressing the pill doesn't start a drag of the
          whole chip and swallow the click that opens the menu. */}
      <span
        onPointerDown={(e) => e.stopPropagation()}
        style={{ display: "flex", flexShrink: 0, cursor: "default" }}
      >
        <PillMenu
          label={roleSummary(lane.roles)}
          tone={lane.roles.length > 0 ? "default" : "muted"}
          items={roleCatalog}
          getKey={(role) => role.id}
          renderLabel={(role) => role.label}
          isSelected={(role) => lane.roles.some((r) => sameRole(r, role))}
          onSelect={(role) => onPickRole(lane, { id: role.id, label: role.label })}
          width={200}
          align="left"
        />
      </span>
      {flags.length > 0 && (
        <Tooltip variant="warning" message={flags.map((f) => f.detail).join(" ")} showIcon={false}>
          <span style={{ display: "flex", color: "var(--color-warning)" }}>
            <IconWarning size={11} />
          </span>
        </Tooltip>
      )}
      {!locked && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(lane)}
          title="Remove from this event"
          aria-label={`Remove ${lane.assignments[0].event.name}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, padding: 0, width: "13px", height: "13px",
            border: "none", background: "transparent", borderRadius: "3px",
            color: "var(--color-text-tertiary)", cursor: "pointer",
            opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 120ms ease",
          }}
        >
          <IconX size={9} />
        </button>
      )}
      {onResizeStart && !locked && (
        <ResizeGrip edge="end" active={resizingEdge === "end"} onStart={onResizeStart} />
      )}
    </div>
  );
}

/** The chip's own edge, not a separate handle beside it — the thing you reach
 *  for is the end of the bar. */
function ResizeGrip({ edge, active, onStart }: {
  edge: "start" | "end";
  active: boolean;
  onStart: (edge: "start" | "end", e: ReactPointerEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onPointerDown={(e) => onStart(edge, e)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: "absolute", top: 0, bottom: 0, [edge === "start" ? "left" : "right"]: 0,
        width: "8px", cursor: "ew-resize", display: "flex", alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{
        width: "2px", height: "9px", borderRadius: "1px",
        background: active || hovered ? "var(--color-accent)" : "var(--color-border-strong)",
        opacity: active || hovered ? 1 : 0, transition: "opacity 120ms ease",
      }} />
    </div>
  );
}

/** Picked from the catalog, not yet placed. It exists only until it is
 *  dropped, because where it lands is the thing the row cannot be created
 *  without — an assignment names a track, always. */
function PendingChip({ event, onCancel }: { event: TournamentEvent; onCancel: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `panel-pending:${event.id}`,
    data: { kind: "panel-pending", eventId: event.id },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "3px 10px", borderRadius: "var(--radius-md)",
        border: "1px dashed var(--color-accent)",
        background: "var(--color-accent-subtle)",
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500,
        cursor: "grab", opacity: isDragging ? 0.4 : 1, outline: "none",
      }}
    >
      {eventNameWithDivision(event)}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel adding this event"
        style={{
          display: "flex", padding: 0, border: "none", background: "transparent",
          color: "var(--color-text-tertiary)", cursor: "pointer",
        }}
      >
        <IconX size={9} />
      </button>
    </div>
  );
}

function DragLabel({ label }: { label: string }) {
  return (
    <div style={{
      padding: "5px 10px", borderRadius: "var(--radius-md)",
      border: "1px solid var(--color-border)", background: "var(--color-surface)",
      fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500,
      boxShadow: "var(--shadow-lg)",
    }}>
      {label}
    </div>
  );
}
