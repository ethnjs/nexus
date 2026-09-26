'use client'

/**
 * Assignments board.
 *
 * Layout: event rows own the page and its scroll. The unassigned member belt
 * is a DockedPanel in the shell's panel slot, and clicking a card opens a
 * second DockedPanel beside it with that member's full record.
 *
 * Each event row's people area is a horizontal timeline — one column per
 * shift, and a bar per person spanning the shifts they cover. Worth knowing
 * how that maps to the API: an assignment row holds ONE shift, so a bar
 * covering three shifts is three assignment rows sharing a membership_role.
 * Resizing a bar adds or removes rows; it does not edit a span.
 *
 * Writes: every mutation (drag, resize, role toggle, remove) updates local
 * state first and syncs to assignmentsApi after — see createAssignmentRow /
 * deleteAssignmentRow and the lane-diff helpers below. A row not yet
 * confirmed by the server carries a negative id (see nextLocalId) so a
 * handler can always tell "real" from "still in flight" without a second
 * bookkeeping structure.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation'
import { type DragEndEvent } from '@dnd-kit/core'

import { DockedPanel } from '@/components/layout/DockedPanel'

import { useRegisterBoardDnd } from '@/components/tournament/assignments/BoardDnd'
import { MemberPanel, MEMBER_PANEL_WIDTH } from '@/components/tournament/members/MemberPanel'
import { useRefetchOnFocus } from '@/lib/useRefetchOnFocus'
import {
  MembersFilterModal, MEMBERS_FILTER_KEYS,
  membersFilterFromStored, membersFilterToStored, membersFilterParams,
  type MembersFilterState,
} from '@/components/tournament/members/MembersFilterModal'
import {
  EventsFilterModal, EVENTS_FILTER_KEYS, EVENT_FILTER_UNSET, EVENT_TYPE_OPTIONS,
  eventCategoryKey, eventCategoryOptions, eventsFilterFromStored,
  eventsFilterToStored, isEventsFilterActive,
  type EventsFilterState,
} from '@/components/tournament/events/EventsFilterModal'
import { emptyFilterState, filterAllows, isFilterActive } from '@/components/ui/FilterModal'
import { useMemberRoleLock } from '@/lib/roles/useMemberRoleLock'
import { useAuth } from '@/lib/useAuth'
import { useMyMembership } from '@/lib/useMyMembership'
import { useTournament } from '@/lib/useTournament'
import { ARCHIVED_REASON } from '@/lib/useArchiveLock'
import { Button } from '@/components/ui/Button'
import { FilterButton } from '@/components/ui/FilterButton'
import { Card } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import table from '@/components/ui/Table.module.css'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconEvents, IconEye, IconLock, IconSearch, IconUser } from '@/components/ui/Icons'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { TabStrip } from '@/components/ui/TabStrip'
import { Spinner } from '@/components/ui/Spinner'
import {
  ASSIGNMENT_CARD_SURFACE, ASSIGNMENTS_EVENTS_SURFACE,
  ApiError, assignmentsApi, displayConfigApi, membersApi, rolesApi, tabSurface, tournamentEventsApi,
  tournamentShiftsApi, tournamentTracksApi,
  type Assignment, type DisplayConfig, type MembershipFull, type Role,
  type TournamentEvent, type TournamentShift, type TournamentTrack,
} from '@/lib/api'
import {
  assignmentFlags,
  assignmentsByEvent,
  memberFacts,
  type Flag,
} from '@/lib/assignments/flags'
import { roleKey, rolesOf, sameRole, type AssignmentRole } from '@/lib/assignments/lanes'
import { persistDisplayConfigSurface } from '@/lib/displayConfig'
import { eventName } from '@/lib/eventDisplay'
import { useSetLayoutPanel } from '@/lib/useLayoutPanel'
import { useInitialPanelId, usePanelUrlSync } from '@/lib/usePanelUrl'
import { useToast } from '@/lib/useToast'

import {
  DEFAULT_EVENT_DISPLAY, EventDisplayModal, eventDisplayFromColumns,
  eventDisplayToColumns, eventDisplayToHidden, type EventDisplayState,
} from '@/components/tournament/assignments/EventDisplayModal'
import {
  DEFAULT_MEMBER_DISPLAY, MemberDisplayModal, defaultMemberDisplayForTab,
  memberDisplayFromHidden, memberDisplayToHidden, type MemberDisplayState,
} from '@/components/tournament/assignments/MemberDisplayModal'
import { MemberCard } from '@/components/tournament/assignments/MemberCard'
import { EventRow } from '@/components/tournament/assignments/EventRow'
import { fullName, laneKeyOf, withOrderedShifts } from '@/lib/assignments/board'

// Narrower than the member panel: a card is a name, a line of experience and
// a few preference badges, and giving it more width just stretches the badges.
const BELT_PANEL_WIDTH = 340

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
export default function AssignmentsPage() {
  const params = useParams()
  const tournamentId = Number(params.id)
  const { show } = useToast()

  const { user: currentUser } = useAuth()
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership()
  const { selectedTournament } = useTournament()
  const {
    canManageMembers, isArchived, canTouchRole, canEditMember,
  } = useMemberRoleLock()

  const isAdmin = currentUser?.role === 'admin'
  const isOwner = !!membership?.is_owner
  const canManageEvents = isAdmin || isOwner || hasPermission('manage_events')
  // Matches the backend's read gate on GET .../assignments/ (manage_events OR
  // manage_members — staffing is part of reading the event, deciding it is
  // member data). Writes need manage_members specifically; see canManageMembers
  // below, checked at each mutation.
  const canView = canManageEvents || canManageMembers

  const [events, setEvents] = useState<TournamentEvent[] | null>(null)
  const [rows, setRows] = useState<Assignment[]>([])
  const [members, setMembers] = useState<MembershipFull[]>([])
  // Bumped after a board write lands for the focused member, so the open
  // MemberPanel re-reads — it holds its own copy of their assignments.
  const [panelAssignmentsVersion, setPanelAssignmentsVersion] = useState(0)
  // Bumped after any assignment write lands, so the belt's server-side
  // filter (the assigned filter especially) re-reads.
  const [boardWriteVersion, setBoardWriteVersion] = useState(0)
  // Bumped when the browser tab regains focus, so collaborators' changes show up.
  const [refreshKey, setRefreshKey] = useState(0)
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1))
  const [allShifts, setAllShifts] = useState<TournamentShift[]>([])
  const [roleCatalog, setRoleCatalog] = useState<Role[]>([])
  const [tracks, setTracks] = useState<TournamentTrack[]>([])
  const [loadError, setLoadError] = useState<string | undefined>()

  // Which member's panel is open, mirrored into ?member= so a refresh — or a
  // link pasted to a colleague — comes back to it. Same param name as the
  // roster's, since it is the same panel showing the same member.
  const initialMemberId = useInitialPanelId('member')
  const [focusedId, setFocusedId] = useState<number | null>(initialMemberId)
  usePanelUrlSync('member', focusedId)

  const [eventQuery, setEventQuery] = useState('')
  const [eventFilters, setEventFilters] = useState<EventsFilterState>(emptyFilterState(EVENTS_FILTER_KEYS))
  const [eventDisplay, setEventDisplay] = useState<EventDisplayState>(DEFAULT_EVENT_DISPLAY)
  const [showEventFilterModal, setShowEventFilterModal] = useState(false)
  const [showEventDisplayModal, setShowEventDisplayModal] = useState(false)

  const [memberQuery, setMemberQuery] = useState('')
  const [memberFilters, setMemberFilters] = useState<MembersFilterState>(emptyFilterState(MEMBERS_FILTER_KEYS))
  const [memberDisplay, setMemberDisplay] = useState<MemberDisplayState>(DEFAULT_MEMBER_DISPLAY)
  const [showMemberFilterModal, setShowMemberFilterModal] = useState(false)
  const [showMemberDisplayModal, setShowMemberDisplayModal] = useState(false)

  // Which track tab is showing; null is All. Mirrored into ?track= so a
  // reload comes back to the day being staffed, the way the buildings board
  // does. A stale id simply falls back to All below.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pickedTrackId, setPickedTrackId] = useState<number | null>(
    () => Number(searchParams.get('track')) || null,
  )
  const simple = tracks.length <= 1
  const activeTrackId = !simple && pickedTrackId !== null && tracks.some((t) => t.id === pickedTrackId)
    ? pickedTrackId
    : null

  function pickTab(key: string) {
    const next = key === 'all' ? null : Number(key)
    setPickedTrackId(next)
    // Merged, so an open ?member= panel survives the tab change.
    const params = new URLSearchParams(window.location.search)
    if (next === null) params.delete('track')
    else params.set('track', String(next))
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // Each tab keeps its own filters, columns and card fields, stored under its
  // own surface key ("assignments_events:track:3"). The whole config is read
  // once and the tab's slice derived from it, rather than a fetch per tab.
  const eventsSurface = tabSurface(ASSIGNMENTS_EVENTS_SURFACE, activeTrackId)
  const cardSurface = tabSurface(ASSIGNMENT_CARD_SURFACE, activeTrackId)
  const [savedConfig, setSavedConfig] = useState<DisplayConfig | null>(null)

  // Read once: unlike the roster's, nothing here gates a fetch (both halves
  // filter client-side), so the board renders on its defaults and settles onto
  // the saved view when this lands, rather than holding the page on a request.
  useEffect(() => {
    if (!canView) return
    let current = true
    displayConfigApi.get(tournamentId)
      .then((config) => { if (current) setSavedConfig(config) })
      // No saved view (or no permission to read one) is not an error — the
      // board's defaults are a perfectly good board.
      .catch(() => { if (current) setSavedConfig({}) })
    return () => { current = false }
  }, [tournamentId, canView])

  // Re-derived per tab, so switching tabs swaps the whole view with it.
  useEffect(() => {
    if (savedConfig === null) return
    const events = savedConfig[eventsSurface]
    setEventFilters(eventsFilterFromStored(events?.filters))
    setEventDisplay(eventDisplayFromColumns(events?.columns, events?.hidden))
    const card = savedConfig[cardSurface]
    setMemberFilters(membersFilterFromStored(card?.filters))
    // Nothing saved for this tab yet: the tab decides which tracks the card
    // starts with, rather than every tab starting with all of them.
    setMemberDisplay(Array.isArray(card?.hidden)
      ? memberDisplayFromHidden(card.hidden)
      : defaultMemberDisplayForTab(tracks.map((t) => t.id), activeTrackId))
  }, [savedConfig, eventsSurface, cardSurface, tracks, activeTrackId])

  /** Persists one surface and keeps the local copy in step, so switching away
   *  and back shows what was just set rather than what was last fetched. */
  const persistSurface = useCallback((surface: string, patch: Record<string, unknown>) => {
    setSavedConfig((cur) => ({
      ...(cur ?? {}),
      [surface]: { hidden: [], ...(cur?.[surface] ?? {}), ...patch },
    }))
    persistDisplayConfigSurface(tournamentId, surface, patch)
  }, [tournamentId])

  const applyEventFilters = useCallback((next: EventsFilterState) => {
    setEventFilters(next)
    persistSurface(eventsSurface, { filters: eventsFilterToStored(next) })
  }, [persistSurface, eventsSurface])

  const applyEventDisplay = useCallback((next: EventDisplayState) => {
    setEventDisplay(next)
    persistSurface(eventsSurface, {
      columns: eventDisplayToColumns(next),
      hidden: eventDisplayToHidden(next),
    })
  }, [persistSurface, eventsSurface])

  const applyMemberFilters = useCallback((next: MembersFilterState) => {
    setMemberFilters(next)
    persistSurface(cardSurface, { filters: membersFilterToStored(next) })
  }, [persistSurface, cardSurface])

  const applyMemberDisplay = useCallback((next: MemberDisplayState) => {
    setMemberDisplay(next)
    persistSurface(cardSurface, { hidden: memberDisplayToHidden(next) })
  }, [persistSurface, cardSurface])

  // Every id a not-yet-synced row gets — negative, so "real" (server-known)
  // vs. "still local" is just `id > 0` anywhere a handler needs to tell them
  // apart, with no second bookkeeping structure to keep in step.
  const localIdRef = useRef(0)
  function nextLocalId(): number {
    localIdRef.current -= 1
    return localIdRef.current
  }

  // Read by handlers that need the *latest* rows from outside React's render
  // cycle — a resize gesture's pointerup fires from a native listener set up
  // once at pointerdown, so the `rows` it would otherwise close over is
  // whatever they were at gesture start, not at release.
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])

  useEffect(() => {
    if (!canView) return
    let current = true
    tournamentEventsApi.list(tournamentId)
      .then((data) => { if (current) setEvents(data.map(withOrderedShifts)) })
      .catch((err: unknown) => {
        if (current) setLoadError(err instanceof ApiError ? err.message : 'Failed to load events.')
      })
    assignmentsApi.list(tournamentId).then((data) => { if (current) setRows(data) }).catch(() => {})
    tournamentShiftsApi.list(tournamentId).then((data) => { if (current) setAllShifts(data) }).catch(() => {})
    rolesApi.list(tournamentId).then((data) => { if (current) setRoleCatalog(data) }).catch(() => {})
    // Live tracks only. The route returns pending-delete ones too (the
    // settings listing is what needs them), so every other consumer drops
    // them the same way — they are on their way out, and the board offers
    // these as things to filter by, hide, or assign a default role from.
    // Columns are unaffected: those come off each event's own `tracks`, so an
    // archived track still attached to an event keeps its column until the
    // delete goes through.
    tournamentTracksApi.list(tournamentId)
      .then((data) => { if (current) setTracks(data.filter((t) => !t.is_archived)) })
      .catch(() => {})
    // manage_members-gated — a coordinator with only manage_events can view
    // the board (assignments read is manage_events OR manage_members) but
    // not the roster, so the belt just degrades to empty for them rather
    // than the page 403ing outright.
    membersApi.list(tournamentId).then((data) => { if (current) setMembers(data) }).catch(() => {})
    return () => { current = false }
  }, [tournamentId, canView, refreshKey])

  // Every event with its hidden tracks stripped out — shifts and tracks both.
  // Derived once and read by *everything* downstream, render and handlers
  // alike: the timeline indexes bars by position in `shifts`, and a resize
  // slices that same array, so a handler working from the unfiltered event
  // while the row draws a filtered one would move the wrong bar.
  // Whether a track is on screen: the tab decides on a track tab, the
  // Display modal's hidden set on All. Asked per id rather than built as a
  // list of hidden ones, because an event can carry a track the catalog no
  // longer lists (an archived one pending delete) — listing the others would
  // let that one through the tab.
  const hiddenTracks = useMemo(() => new Set(eventDisplay.hiddenTracks), [eventDisplay.hiddenTracks])
  const showsTrack = useCallback((id: number) => (activeTrackId === null
    ? !hiddenTracks.has(id)
    : id === activeTrackId
  ), [activeTrackId, hiddenTracks])

  // The catalog's hidden ids, for the row-level rules below that reason about
  // tracks rather than about one event's copy of them.
  const hiddenTrackIds = useMemo(
    () => tracks.filter((t) => !showsTrack(t.id)).map((t) => t.id),
    [tracks, showsTrack],
  )

  const boardEvents = useMemo(() => (events ?? []).map((event) => ({
    ...event,
    shifts: event.shifts.filter((s) => showsTrack(s.track_id)),
    tracks: event.tracks.filter((t) => showsTrack(t.id)),
  })), [events, showsTrack])

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  // Display only, so it is built from `rows` rather than replacing it: a row
  // pinned to a hidden track's shift is dropped here, but stays in `rows` for
  // the conflict flags and for every write path — hiding a day must not make
  // a double-booking on it invisible to the day that is showing.
  const visibleRows = useMemo(() => {
    const hidden = new Set(hiddenTrackIds)
    if (hidden.size === 0) return rows
    // An unpinned row names no track, so it goes by the same role match that
    // buckets it into a column (see bucketByTrack) — otherwise hiding Test
    // Writing would leave its people showing under Writer's Class. Only roles
    // that are *no* visible track's default count, so a shared default never
    // hides someone the remaining column is still speaking for.
    const claimed = new Set(tracks.filter((t) => !t.is_primary && !hidden.has(t.id))
      .map((t) => t.default_role_id))
    const hiddenRoles = new Set(tracks
      .filter((t) => !t.is_primary && hidden.has(t.id) && t.default_role_id !== null)
      .map((t) => t.default_role_id)
      .filter((roleId) => !claimed.has(roleId)))
    return rows.filter((row) => (row.shift === null
      ? !hiddenRoles.has(row.role.id)
      : !hidden.has(row.shift.track_id)))
  }, [rows, tracks, hiddenTrackIds])

  const byEvent = useMemo(() => assignmentsByEvent(visibleRows), [visibleRows])

  const eventFilterActive = isEventsFilterActive(eventFilters)
  const memberFilterActive = isFilterActive(memberFilters)

  // Full objects, not shifts derived from them — a cosmetic track (Test
  // Writing) has no shifts of its own but still belongs on an event and still
  // carries a default role. See TournamentEvent.tracks.
  const eventTrackIds = useMemo(
    () => new Map((boardEvents ?? []).map((e) => [e.id, e.tracks.map((t) => t.id)])),
    [boardEvents],
  )

  const divisionOptions = useMemo(() => {
    const options = [...new Set((boardEvents ?? []).map((e) => e.division))]
      .filter((d) => d !== null)
      .map((d) => ({ value: d, label: `Division ${d}` }))
    // Offered only when something actually has no division — otherwise it is
    // a row that can only ever match nothing.
    return (boardEvents ?? []).some((e) => e.division === null)
      ? [...options, { value: EVENT_FILTER_UNSET, label: 'No division' }]
      : options
  }, [boardEvents])
  const categoryOptions = useMemo(() => eventCategoryOptions(boardEvents ?? []), [boardEvents])

  const visibleEvents = useMemo(() => {
    const text = eventQuery.trim().toLowerCase()
    return (boardEvents ?? []).filter((event) => {
      if (text && !eventName(event).toLowerCase().includes(text)) return false
      if (!filterAllows(eventFilters.division, event.division ?? EVENT_FILTER_UNSET)) return false
      if (!filterAllows(eventFilters.type, event.event_type)) return false
      if (!filterAllows(eventFilters.category, eventCategoryKey(event))) return false
      // Multi-valued, so filterAllows doesn't fit: an event passes when *any*
      // of its tracks is picked — filtering to Day 1 shouldn't hide an event
      // that runs on both Day 1 and Day 2.
      // A track tab narrows to its own track; the All tab honours whatever
      // the saved filter says.
      const wantedTracks = activeTrackId === null
        ? eventFilters.track
        : new Set([String(activeTrackId)])
      if (wantedTracks.size > 0) {
        const ids = (eventTrackIds.get(event.id) ?? []).map(String)
        if (!ids.some((id) => wantedTracks.has(id))) return false
      }
      const staffed = (byEvent.get(event.id)?.length ?? 0) > 0
      if (!filterAllows(eventFilters.staffing, staffed ? 'staffed' : 'unstaffed')) return false
      return true
    })
  }, [activeTrackId, boardEvents, byEvent, eventFilters, eventQuery, eventTrackIds])


  // Members matching the filters, from the same server filter the members
  // page uses — a client copy drifted. Re-read after writes so the assigned
  // filter follows a drag. null = no filters set, so everyone passes.
  const [filterMatchIds, setFilterMatchIds] = useState<Set<number> | null>(null)
  useEffect(() => {
    const filters = membersFilterParams(memberFilters)
    if (!canView || Object.keys(filters).length === 0) {
      setFilterMatchIds(null)
      return
    }
    let current = true
    membersApi.list(tournamentId, { fields: [], filters })
      .then((data) => { if (current) setFilterMatchIds(new Set(data.map((m) => m.id))) })
      .catch(() => { if (current) setFilterMatchIds(null) })
    return () => { current = false }
  }, [tournamentId, canView, memberFilters, boardWriteVersion, refreshKey])

  const belt = useMemo(() => {
    const text = memberQuery.trim().toLowerCase()

    return members.filter((member) => {
      if (text && !fullName(member.user ?? { first_name: null, last_name: null })
        .toLowerCase().includes(text)) return false
      if (filterMatchIds && !filterMatchIds.has(member.id)) return false
      return true
    })
  }, [filterMatchIds, members, memberQuery])

  const flagsFor = useMemo(() => {
    const perMember = new Map<number, Assignment[]>()
    for (const row of rows) {
      const key = row.member.membership_id
      if (key === null) continue
      const list = perMember.get(key)
      if (list) list.push(row)
      else perMember.set(key, [row])
    }
    return (assignment: Assignment): Flag[] => {
      const id = assignment.member.membership_id
      const member = id === null ? undefined : memberById.get(id)
      if (!member) return []
      return assignmentFlags(
        assignment,
        memberFacts(member, perMember.get(member.id) ?? []),
        { eventTrackIds },
      )
    }
  }, [memberById, rows, eventTrackIds])

  // ---------------------------------------------------------------------
  // Server sync — every write lands here or in the two per-gesture callers
  // below. Local state moves first; the API call follows and reconciles
  // (a create swaps the temp row for the server's, a failed write rolls
  // its local change back and toasts).
  // ---------------------------------------------------------------------

  /** Every mutating handler's first line. Matches the backend's write gate
   *  on the assignments routes (manage_members) — narrower than canView,
   *  which also admits manage_events alone for reading the board. */
  function requireWriteAccess(): boolean {
    if (!canManageMembers) {
      show("You need the manage members permission to edit assignments.", 'error')
      return false
    }
    if (isArchived) {
      show(ARCHIVED_REASON, 'error')
      return false
    }
    return true
  }

  async function createAssignmentRow(row: Assignment) {
    try {
      const created = await assignmentsApi.create(tournamentId, {
        tournament_event_id: row.event.id,
        membership_id: row.member.membership_id!,
        role_id: row.role.id!,
        tournament_shift_id: row.shift?.id ?? null,
        // Ignored by the server when a shift is given (the shift names its
        // own track); the whole answer when one isn't.
        tournament_track_id: row.shift ? null : row.track.id,
      })
      setRows((current) => current.map((r) => (r.id === row.id ? created : r)))
      afterWrite(row)
    } catch (err) {
      setRows((current) => current.filter((r) => r.id !== row.id))
      show(err instanceof ApiError ? err.message : 'Failed to assign — the change was rolled back.', 'error')
    }
  }

  async function deleteAssignmentRow(row: Assignment) {
    // A row that never reached the server (its create is still in flight, or
    // failed and was already rolled back) has nothing there to remove.
    if (row.id < 0) return
    try {
      await assignmentsApi.delete(tournamentId, row.id)
      afterWrite(row)
    } catch (err) {
      setRows((current) => [...current, row])
      show(err instanceof ApiError ? err.message : 'Failed to remove — restored.', 'error')
    }
  }

  function afterWrite(row: Assignment) {
    setBoardWriteVersion((v) => v + 1)
    if (row.member.membership_id === focusedId) setPanelAssignmentsVersion((v) => v + 1)
  }

  /** The member panel wrote this member's assignments — swap their rows on
   *  the board for the server's. Only theirs, so other in-flight rows survive. */
  function refreshMemberRows(membershipId: number) {
    assignmentsApi.list(tournamentId, { membershipId })
      .then((fresh) => {
        setRows((current) => [
          ...current.filter((r) => r.member.membership_id !== membershipId), ...fresh,
        ])
        setBoardWriteVersion((v) => v + 1)
      })
      .catch(() => {})
  }

  /** The role a track hands a member placed on it with nothing picked yet —
   *  see TournamentTrack.default_role_id. `trackId` names the track a drop
   *  aimed at; without one the event's first track answers, which is only
   *  ever right when there is nothing to disambiguate. A track with no
   *  default configured, or an event with no track at all, has nothing to
   *  fall back to. */
  /** The track a drop bills its default role to. A cosmetic column names one;
   *  a shift or all-shifts drop takes the track its shifts fall on, since a
   *  shift belongs to exactly one primary track. Only the bare row target,
   *  which by then has neither, falls back to the event's first track. */
  function trackForDropId(
    kind: string, target: Record<string, unknown>,
    event: TournamentEvent, shiftIds: (number | null)[],
  ): number | undefined {
    if (kind === 'track') return target.trackId as number
    const shiftId = shiftIds.find((id): id is number => id !== null)
    return event.shifts.find((s) => s.id === shiftId)?.track_id
  }

  function trackForDrop(event: TournamentEvent, trackId?: number): TournamentTrack | undefined {
    // Only the bare row target arrives without an id, and it has nothing but
    // the event's own list to go on.
    if (trackId === undefined) return event.tracks[0]
    // Otherwise the tournament's catalog, not `event.tracks`. A shift names
    // the track it falls on and that is authoritative — an event's track list
    // is a separate bridge and the two do drift, so looking the id up in the
    // event's list turns a perfectly good shift into "this event has no
    // track". Falls back to the event's own list for a track the catalog
    // drops, i.e. one that is pending delete.
    return trackById.get(trackId) ?? event.tracks.find((t) => t.id === trackId)
  }

  /** The compact track an optimistic row carries, shaped like the server's
   *  TournamentTrackRef so the local row and the one that replaces it read
   *  the same. */
  function trackRefFor(event: TournamentEvent, trackId?: number) {
    const track = trackForDrop(event, trackId)
    return track ? { id: track.id, name: track.name, is_primary: track.is_primary } : null
  }

  function defaultRoleFor(event: TournamentEvent, trackId?: number): Role | null {
    const roleId = trackForDrop(event, trackId)?.default_role_id ?? null
    if (roleId === null) return null
    return roleCatalog.find((r) => r.id === roleId) ?? null
  }

  /**
   * Rewrite one lane as exactly `shiftIds × roles`.
   *
   * A lane is a grid: one assignment row per shift per role. Resizing changes
   * the shift axis, the role pill changes the role axis, and both are the same
   * write — so both land here rather than each hand-rolling its own add/drop
   * pass. Rows for a (shift, role) pair that already exists are reused by
   * identity, so an edit only churns the cells that actually changed — and
   * `added`/`removed` name exactly those cells, for the caller to sync.
   *
   * `event` is the *filtered* event (see boardEvents), so its shifts are the
   * ones on screen. Rows pinned to a shift that isn't — a track the viewer
   * has hidden — are parked untouched rather than rewritten: this rewrites a
   * lane to what the grid says, and the grid can only speak for the columns
   * it is drawing. Without that, resizing a Day 1 bar with Day 2 hidden would
   * delete every Day 2 row in the lane.
   */
  function rebuildLane(
    current: Assignment[],
    eventId: number,
    laneKey: string,
    shiftIds: (number | null)[],
    roles: AssignmentRole[],
    event: TournamentEvent,
  ): { rows: Assignment[]; added: Assignment[]; removed: Assignment[] } {
    const everyRow = current.filter((row) =>
      row.event.id === eventId && laneKeyOf(row) === laneKey)
    const onScreen = new Set(event.shifts.map((s) => s.id))
    const parked = everyRow.filter((row) => row.shift !== null && !onScreen.has(row.shift.id))
    const inLane = everyRow.filter((row) => row.shift === null || onScreen.has(row.shift.id))
    if (inLane.length === 0 || roles.length === 0) return { rows: current, added: [], removed: [] }

    const laneIds = new Set(everyRow.map((row) => row.id))
    const cellKey = (shiftId: number | null, role: AssignmentRole) =>
      `${shiftId ?? 'none'}|${roleKey(role)}`
    const existing = new Map(inLane.map((row) => [cellKey(row.shift?.id ?? null, row.role), row]))

    const next: Assignment[] = []
    for (const shiftId of shiftIds) {
      for (const role of roles) {
        const found = existing.get(cellKey(shiftId, role))
        const shift = shiftId === null ? null : event.shifts.find((s) => s.id === shiftId) ?? null
        next.push(found ?? {
          ...inLane[0],
          id: nextLocalId(),
          role,
          shift,
          // An event can hold shifts on more than one day, so a bar stretched
          // across them changes track as it goes. Unpinned cells keep the
          // lane's own track — there is no shift to take one from.
          track: (shift ? trackRefFor(event, shift.track_id) : null) ?? inLane[0].track,
          updated_at: new Date().toISOString(),
        })
      }
    }

    // Same cells as before — hand back the identical array so React can skip
    // the render. A resize commits on every pointer move, so this is the
    // common case, not the rare one.
    if (next.length === inLane.length && next.every((row) => laneIds.has(row.id))) {
      return { rows: current, added: [], removed: [] }
    }
    const nextIds = new Set(next.map((row) => row.id))
    return {
      rows: [...current.filter((row) => !laneIds.has(row.id)), ...parked, ...next],
      added: next.filter((row) => !laneIds.has(row.id)),
      removed: inLane.filter((row) => !nextIds.has(row.id)),
    }
  }

  /** The lane's distinct shifts in the event's own order. `[null]` keeps an
   *  unpinned lane unpinned rather than silently pinning it to shift one. */
  function laneShiftIds(inLane: Assignment[], event: TournamentEvent): (number | null)[] {
    const have = new Set(inLane.map((row) => row.shift?.id ?? null))
    const ordered = event.shifts.filter((s) => have.has(s.id)).map((s) => s.id)
    return ordered.length > 0 ? ordered : [null]
  }

  /**
   * Resize a bar so it reaches `index`.
   *
   * Reads the lane out of current rows by key rather than taking a captured
   * Lane: a resize commits on every pointer move, so anything captured at
   * pointerdown is stale by the second frame — the rows it names have already
   * been replaced. That staleness is why the bar used to stop tracking the
   * cursor after one step. Purely local — see onResizeCommit for the sync,
   * which fires once, on release, rather than once per pixel.
   */
  function handleResize(laneKey: string, eventId: number, edge: 'start' | 'end', index: number) {
    if (!canManageMembers || isArchived) return
    const event = (boardEvents ?? []).find((e) => e.id === eventId)
    if (!event) return

    setRows((current) => {
      const inLane = current.filter((row) =>
        row.event.id === eventId && laneKeyOf(row) === laneKey)
      if (inLane.length === 0) return current

      const shiftIds = event.shifts.map((s) => s.id)
      const covered = inLane
        .map((row) => (row.shift ? shiftIds.indexOf(row.shift.id) : -1))
        .filter((i) => i >= 0)
      if (covered.length === 0) return current

      const first = Math.min(...covered)
      const last = Math.max(...covered)
      // The dragged edge moves; the other one anchors.
      const from = edge === 'start' ? Math.min(index, last) : first
      const to = edge === 'start' ? last : Math.max(index, first)

      return rebuildLane(
        current, eventId, laneKey,
        event.shifts.slice(from, to + 1).map((s) => s.id),
        rolesOf(inLane), event,
      ).rows
    })
  }

  /** Syncs a resize gesture's net effect once it ends — the whole-lane diff
   *  between `beforeRows` (pointerdown) and rowsRef (release), rather than a
   *  write per pointermove. Cells that were added then removed again within
   *  the same gesture cancel out here for free — neither ever reaches this
   *  as a diff, since only the endpoints are compared. */
  function handleResizeCommit(laneKey: string, eventId: number, beforeRows: Assignment[]) {
    const beforeIds = new Set(beforeRows.map((r) => r.id))
    const current = rowsRef.current.filter((row) =>
      row.event.id === eventId && laneKeyOf(row) === laneKey)
    const currentIds = new Set(current.map((r) => r.id))
    for (const row of current.filter((r) => !beforeIds.has(r.id))) createAssignmentRow(row)
    for (const row of beforeRows.filter((r) => !currentIds.has(r.id))) deleteAssignmentRow(row)
  }

  /** Drop a whole bar: every row for that member on that event, across every
   *  shift and role. Removing one row would leave a torn span or a stray role
   *  behind, which is not what an × on the chip promises. */
  function handleRemove(laneKey: string, eventId: number) {
    if (!requireWriteAccess()) return
    const toRemove = rows.filter((row) => row.event.id === eventId && laneKeyOf(row) === laneKey)
    setRows((current) => current.filter((row) =>
      !(row.event.id === eventId && laneKeyOf(row) === laneKey)))
    for (const row of toRemove) deleteAssignmentRow(row)
  }

  /** Add or drop one role across every shift the bar covers. Roles belong to
   *  the bar, not to a single column — a runner for the first half and a
   *  scorer for the second is two bars, which is what dragging one out gives
   *  you. A single discrete action, unlike resize, so it syncs immediately. */
  /**
   * Rewrite one lane's roles, keeping its shifts. `next` is handed the lane's
   * roles as they are *now* rather than as the chip last rendered them —
   * a menu left open across someone else's change would otherwise write back
   * a set built from stale props.
   */
  function setLaneRoles(
    laneKey: string, eventId: number,
    next: (current: AssignmentRole[]) => AssignmentRole[],
  ) {
    if (!requireWriteAccess()) return
    const event = (boardEvents ?? []).find((e) => e.id === eventId)
    if (!event) return

    const inLane = rows.filter((row) => row.event.id === eventId && laneKeyOf(row) === laneKey)
    if (inLane.length === 0) return

    const nextRoles = next(rolesOf(inLane))
    // Emptying a lane would delete the assignment outright, which is the ×'s
    // job. The picker locks the last role, but a stale click could still land.
    if (nextRoles.length === 0) return

    const { rows: nextRows, added, removed } = rebuildLane(
      rows, eventId, laneKey, laneShiftIds(inLane, event), nextRoles, event,
    )
    setRows(nextRows)
    for (const row of added) createAssignmentRow(row)
    for (const row of removed) deleteAssignmentRow(row)
  }

  function handleToggleRole(laneKey: string, eventId: number, role: AssignmentRole) {
    setLaneRoles(laneKey, eventId, (current) => (current.some((r) => sameRole(r, role))
      ? current.filter((r) => !sameRole(r, role))
      : [...current, role].sort((a, b) => a.label.localeCompare(b.label))))
  }

  /** Swap every role for this one. Picking the role someone already solely
   *  holds rebuilds the same lane, which rebuildLane recognises as no change
   *  and writes nothing for. */
  function handlePickRole(laneKey: string, eventId: number, role: AssignmentRole) {
    setLaneRoles(laneKey, eventId, () => [role])
  }

  // A track's default role, changed from its timeline header. Scoped to the
  // whole track across the tournament — not to the one event the header
  // happened to be drawn on — since the default role is a track setting, and
  // "change every Volunteer on Day 1 to Test Writer" means every event on
  // Day 1, not just this one.
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    track: TournamentTrack
    oldRole: Role
    newRole: Role
    affected: Assignment[]
    resolve: () => void
  } | null>(null)

  async function applyDefaultRoleChange(track: TournamentTrack, newRole: Role, affected: Assignment[]) {
    const updated = await tournamentTracksApi.update(tournamentId, track.id, { default_role_id: newRole.id })
    setTracks((current) => current.map((t) => (t.id === track.id ? updated : t)))
    if (affected.length > 0) {
      await Promise.all(affected.map((row) =>
        assignmentsApi.update(tournamentId, row.id, { role_id: newRole.id })))
      const nextRole: AssignmentRole = { id: newRole.id, label: newRole.label }
      const affectedIds = new Set(affected.map((r) => r.id))
      setRows((current) => current.map((r) => (affectedIds.has(r.id) ? { ...r, role: nextRole } : r)))
      setBoardWriteVersion((v) => v + 1)
    }
  }

  /** Picking a new default role for a track. Only the people currently
   *  holding the *old* default on that track move to the new one — anyone
   *  staffed under a different role is untouched, since a role they were
   *  deliberately given is not the same fact as a role they inherited from
   *  the track's default. Nothing to migrate (no default set yet, or nobody
   *  holds it) applies immediately with no prompt. */
  function requestDefaultRoleChange(track: TournamentTrack, newRole: Role): Promise<void> {
    if (!requireWriteAccess()) return Promise.resolve()
    if (track.default_role_id === newRole.id) return Promise.resolve()
    const oldRole = track.default_role_id === null
      ? null
      : roleCatalog.find((r) => r.id === track.default_role_id) ?? null
    const affected = oldRole
      ? rows.filter((r) => r.track.id === track.id && r.role.id === oldRole.id)
      : []
    if (!oldRole || affected.length === 0) return applyDefaultRoleChange(track, newRole, [])
    return new Promise<void>((resolve) => {
      setPendingRoleChange({ track, oldRole, newRole, affected, resolve })
    })
  }

  const { setPanel, clearPanel } = useSetLayoutPanel()
  const focused = focusedId === null ? null : memberById.get(focusedId) ?? null

  // Both panels live in the shell's single slot as one flex row, since the
  // slot holds one registration at a time. Widths add up so the board gives
  // back exactly what the open panels take.
  useEffect(() => {
    const index = focused ? belt.findIndex((m) => m.id === focused.id) : -1

    setPanel(
      <div style={{ display: 'flex', height: '100%' }}>
        {/* No onClose: the belt is the only way onto the board, so a control
            that hides it would leave the page unable to do its one job. */}
        <DockedPanel
          width={BELT_PANEL_WIDTH}
          headerActions={
            <>
              <Button
                type="button" variant="secondary" size="sm" iconOnly
                title="Configure member cards"
                onClick={() => setShowMemberDisplayModal(true)}
              >
                <IconEye size={14} />
              </Button>
              <FilterButton
                size="sm" iconOnly label="Filter members"
                active={memberFilterActive}
                onOpen={() => setShowMemberFilterModal(true)}
                onClear={() => applyMemberFilters(emptyFilterState(MEMBERS_FILTER_KEYS))}
              />
            </>
          }
        >
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* secondary = white. primary is the same light grey as the page
                background, which would make the field disappear into it. */}
            <Input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              onClear={() => setMemberQuery('')}
              placeholder="Search members"
              icon={<IconSearch />}
              size="md"
              variant="secondary"
              font="sans"
              fullWidth
            />
            <span className={table.headerLabel}>Members — {belt.length}/{members.length}</span>

            {belt.length === 0 ? (
              <EmptyState
                icon={<IconUser size={24} />}
                title={memberQuery || memberFilterActive ? 'No members match' : 'No members yet'}
                description={memberQuery || memberFilterActive ? 'Try a wider filter.' : undefined}
                action={
                  memberQuery || memberFilterActive ? (
                    <Button
                      size="sm" variant="secondary"
                      onClick={() => { setMemberQuery(''); applyMemberFilters(emptyFilterState(MEMBERS_FILTER_KEYS)) }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              belt.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  selected={focusedId === member.id}
                  display={memberDisplay}
                  allShifts={allShifts}
                  onOpen={() => setFocusedId(member.id)}
                />
              ))
            )}
          </div>
        </DockedPanel>

        {focused && (
          <MemberPanel
            key={focused.id}
            tournamentId={tournamentId}
            membershipId={focused.id}
            allRoles={roleCatalog}
            canTouchRole={canTouchRole}
            canEditMember={canEditMember}
            collectIsOver18={!!selectedTournament?.collect_is_over_18}
            collectIsOver21={!!selectedTournament?.collect_is_over_21}
            isArchived={isArchived}
            isSelf={currentUser?.id === focused.user.id}
            // No onRemove/onSelfRemove: removing someone from the tournament
            // is the roster's job, not this board's — omitting them hides
            // the control entirely rather than wiring a flow that doesn't
            // belong here.
            onClose={() => setFocusedId(null)}
            // Roles only: the roles PATCH returns none of the built groups
            // (event prefs, track statuses), so swapping the row would blank them.
            onUpdated={(updated) => setMembers((prev) => prev.map((m) => (
              m.id === updated.id ? { ...m, roles: updated.roles } : m
            )))}
            onAssignmentsChanged={() => refreshMemberRows(focused.id)}
            assignmentsVersion={panelAssignmentsVersion}
            onPrev={() => index > 0 && setFocusedId(belt[index - 1].id)}
            onNext={() => index < belt.length - 1 && setFocusedId(belt[index + 1].id)}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < belt.length - 1}
          />
        )}
      </div>,
      BELT_PANEL_WIDTH + (focused ? MEMBER_PANEL_WIDTH : 0),
    )
  }, [
    focused, focusedId, belt, members, allShifts, memberQuery, memberFilters, panelAssignmentsVersion,
    memberFilterActive, memberDisplay, applyMemberFilters, setPanel, clearPanel,
  ])

  // Unmount only — leaving the page must not leave the panels behind.
  useEffect(() => () => clearPanel(), [clearPanel])
  /**
   * Which shifts a drop lands on.
   *
   *   shift    that one column
   *   allday   every shift the event has
   *   track    one cosmetic track's column — no shift, and its default role
   *   event    the row itself, for an event with neither of the above
   *
   * Returns null shifts as [null] rather than [] so the caller always writes
   * exactly one row per entry — an empty list would silently assign nobody.
   */
  function targetShiftIds(target: Record<string, unknown>, event: TournamentEvent) {
    if (target.kind === 'shift') return [target.shiftId as number]
    if (target.kind === 'allday') {
      return event.shifts.length > 0 ? event.shifts.map((s) => s.id) : [null]
    }
    return [null]
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    const target = over.data.current
    if (!target) return
    const kind = target.kind as string
    if (kind !== 'shift' && kind !== 'allday' && kind !== 'event' && kind !== 'track') return
    if (!requireWriteAccess()) return

    const eventId = target.eventId as number
    const event = (boardEvents ?? []).find((e) => e.id === eventId)
    if (!event) return
    const shiftIds = targetShiftIds(target, event)
    const source = active.data.current

    const eventRef = {
      // Resolved the way the server resolves it (EventMemberRead sends
      // display_name), so an optimistic row names its event like a real one.
      id: event.id, name: eventName(event), division: event.division,
      event_type: event.event_type, shifts: event.shifts,
    }
    const shiftFor = (id: number | null) =>
      id === null ? null : event.shifts.find((s) => s.id === id) ?? null

    if (source?.kind === 'chip') {
      const assignment = source.assignment as Assignment
      // Move the whole bar, not the one row under the cursor: a bar is a
      // grid of rows sharing a membership, and moving one of them would tear
      // the span — or drop every role but one.
      const laneKey = laneKeyOf(assignment)
      const moving = rows.filter((row) =>
        row.event.id === assignment.event.id && laneKeyOf(row) === laneKey)
      const movingIds = new Set(moving.map((r) => r.id))
      const template = moving[0] ?? assignment
      const rolesToKeep = rolesOf(moving.length > 0 ? moving : [assignment])

      // Diffed by cell rather than deleted and recreated wholesale, the same
      // way rebuildLane treats a resize. Two reasons, and the second is the
      // one that bites: a drop that changes nothing has to write nothing, and
      // a drop that *overlaps* its own bar (shifts 1-2 dragged onto 2-3)
      // shares the (shift 2, role) cell with itself. Recreating that cell
      // races the delete of the row already holding it — the create loses on
      // the unique index, rolls back, and then the delete takes the original
      // away, so the person silently loses a shift they never left.
      //
      // Only within one event. A cross-event move shares no cells (the row
      // names its event) and has no single PATCH for it either, since the
      // shift is what a write can repoint — so it stays a delete and create.
      const sameEvent = event.id === assignment.event.id
      const trackRef = trackRefFor(event, trackForDropId(kind, target, event, shiftIds))
      if (!trackRef) {
        show('This drop names no track to assign against.', 'error')
        return
      }
      // The track is part of a cell's identity, not just its payload: two
      // unpinned rows for the same person and role differ only by it, so
      // dragging a chip from Test Writing to Test Reviewing has to read as a
      // move rather than as a drop onto the cell it already occupies.
      const cellKey = (shiftId: number | null, trackId: number, role: AssignmentRole) =>
        `${shiftId ?? 'none'}|${trackId}|${roleKey(role)}`
      const reusable = new Map(
        sameEvent
          ? moving.map((row) => [cellKey(row.shift?.id ?? null, row.track.id, row.role), row])
          : [],
      )

      const kept: Assignment[] = []
      const added: Assignment[] = []
      for (const shiftId of shiftIds) {
        for (const role of rolesToKeep) {
          const found = reusable.get(cellKey(shiftId, trackRef.id, role))
          if (found) { kept.push(found); continue }
          added.push({
            ...template,
            id: nextLocalId(),
            event: eventRef,
            role,
            shift: shiftFor(shiftId),
            track: trackRef,
            updated_at: new Date().toISOString(),
          })
        }
      }
      const keptIds = new Set(kept.map((row) => row.id))
      const removed = moving.filter((row) => !keptIds.has(row.id))

      // Put back exactly where it came from. Not an error to swallow — there
      // is nothing to write, so nothing is written and the rows never leave
      // state. A *different* card landing on an occupied cell still creates,
      // still hits the unique index, and still reports the 409: the server
      // can't tell those two apart, only this can.
      if (added.length === 0 && removed.length === 0) return

      setRows((current) => [
        ...current.filter((row) => !movingIds.has(row.id)), ...kept, ...added,
      ])
      for (const row of removed) deleteAssignmentRow(row)
      for (const row of added) createAssignmentRow(row)
      return
    }

    if (source?.kind === 'member') {
      const member = memberById.get(source.membershipId as number)
      if (!member) return

      // Which track's default role this drop grants. A cosmetic column says
      // so outright; a shift knows the day it falls on, so a timeline drop
      // answers from the shift rather than from whichever track happened to
      // be listed first on the event.
      const trackId = trackForDropId(kind, target, event, shiftIds)
      const role = defaultRoleFor(event, trackId)
      if (!role) {
        const track = trackForDrop(event, trackId)
        show(
          !track
            ? 'This event has no track to look up a default role from.'
            : `No default role set for ${track.name} — set one in tournament settings before assigning from the board.`,
          'error',
        )
        return
      }

      // Every row names its track now, so an optimistic one has to as well —
      // it is what files the chip into a column before the server answers.
      const trackRef = trackRefFor(event, trackId)
      if (!trackRef) {
        show('This drop names no track to assign against.', 'error')
        return
      }
      const newRows: Assignment[] = shiftIds.map((shiftId) => ({
        id: nextLocalId(),
        event: eventRef,
        track: trackRef,
        member: {
          user_id: member.user!.id,
          membership_id: member.id,
          first_name: member.user!.first_name,
          last_name: member.user!.last_name,
        },
        role,
        shift: shiftFor(shiftId),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      setRows((current) => [...current, ...newRows])
      for (const row of newRows) createAssignmentRow(row)
    }
  }

  function labelFor(activeId: string) {
    if (activeId.startsWith('member:')) {
      const member = memberById.get(Number(activeId.slice(7)))
      return member ? fullName(member.user ?? { first_name: null, last_name: null }) : null
    }
    const assignment = rows.find((r) => `chip:${r.id}` === activeId)
    return assignment ? fullName(assignment.member) : null
  }

  // The DndContext lives in the layout — the belt is rendered into the panel
  // slot, which is outside <main>, so a context inside this page could never
  // reach it. Behaviour still belongs here; only the context moved.
  useRegisterBoardDnd('board', {
    onDragEnd: handleDragEnd,
    renderOverlay: (activeId) => {
      const label = labelFor(activeId)
      if (!label) return null
      return (
        <div style={{
          padding: '6px 10px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          {label}
        </div>
      )
    },
  })

  if (membershipLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spinner size="lg" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div>
        <PageHeader heading="Assignments" />
        <Card radius="lg" style={{ padding: '8px' }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage events or manage members permission to view this page."
          />
        </Card>
      </div>
    )
  }

  if (events === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    // No padding or max-width of its own: the shell's <main> already supplies
    // 22px/24px, and a centred max-width fought the docked panels for space.
    <div>
      <PageHeader
        heading="Assignments"
      />

      {/* Hidden in simple mode: with one track, All is the only tab there
          could be. */}
      {!simple && (
        <TabStrip
          tabs={[{ key: 'all', label: 'All' }, ...tracks.map((t) => ({ key: String(t.id), label: t.name }))]}
          activeKey={activeTrackId === null ? 'all' : String(activeTrackId)}
          onChange={pickTab}
        />
      )}

      {loadError && (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)', marginBottom: '10px' }}>
          {loadError}
        </p>
      )}

      {/* Events own the page and its scroll — no inner scroller. */}
      <div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Input
              value={eventQuery}
              onChange={(e) => setEventQuery(e.target.value)}
              onClear={() => setEventQuery('')}
              placeholder="Search events"
              icon={<IconSearch />}
              size="md"
              variant="secondary"
              font="sans"
              fullWidth
            />
            <FilterButton
              active={eventFilterActive}
              onOpen={() => setShowEventFilterModal(true)}
              onClear={() => applyEventFilters(emptyFilterState(EVENTS_FILTER_KEYS))}
            />
            <Button size="md" variant="secondary" onClick={() => setShowEventDisplayModal(true)}>
              <IconEye size={14} /> Display
            </Button>
          </div>
          <span className={table.headerLabel}>Events — {visibleEvents.length}/{events.length}</span>

          {visibleEvents.length === 0 ? (
            <EmptyState
              icon={<IconEvents size={24} />}
              title="No events match"
              description="Try a wider search or filter."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setEventQuery(''); applyEventFilters(emptyFilterState(EVENTS_FILTER_KEYS)) }}
                >
                  Clear
                </Button>
              }
            />
          ) : (
            visibleEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                rowAssignments={byEvent.get(event.id) ?? []}
                roleCatalog={roleCatalog}
                flagsFor={flagsFor}
                display={eventDisplay}
                activeTrackId={activeTrackId}
                simple={simple}
                onResize={handleResize}
                onResizeCommit={handleResizeCommit}
                onToggleRole={handleToggleRole}
                onPickRole={handlePickRole}
                onRemove={handleRemove}
                onPickDefaultRole={requestDefaultRoleChange}
              />
            ))
          )}
        </div>

      </div>

      {showEventFilterModal && (
        <EventsFilterModal
          divisionOptions={divisionOptions}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={categoryOptions}
          showStaffing
          filters={eventFilters}
          onApply={applyEventFilters}
          onClose={() => setShowEventFilterModal(false)}
        />
      )}
      {showEventDisplayModal && (
        <EventDisplayModal
          display={eventDisplay}
          tracks={activeTrackId === null ? tracks : []}
          onApply={applyEventDisplay}
          onClose={() => setShowEventDisplayModal(false)}
        />
      )}
      {/* No `options` — the roster's own modal fetches the real tournament's
          filter options itself when it isn't handed pre-built ones. */}
      {showMemberFilterModal && (
        <MembersFilterModal
          tournamentId={tournamentId}
          roleOptions={roleCatalog.map((r) => ({ value: String(r.id), label: r.label }))}
          filters={memberFilters}
          onApply={applyMemberFilters}
          onClose={() => setShowMemberFilterModal(false)}
        />
      )}
      {showMemberDisplayModal && (
        <MemberDisplayModal
          display={memberDisplay}
          tracks={tracks.map((t) => ({ id: t.id, label: t.name }))}
          onApply={applyMemberDisplay}
          onClose={() => setShowMemberDisplayModal(false)}
        />
      )}
      {pendingRoleChange && (
        <ConfirmModal
          title="Change default role"
          description={
            <>
              {pendingRoleChange.track.name}&rsquo;s default role is changing from{' '}
              <strong>{pendingRoleChange.oldRole.label}</strong> to{' '}
              <strong>{pendingRoleChange.newRole.label}</strong>. This will also change{' '}
              {pendingRoleChange.affected.length} existing {pendingRoleChange.oldRole.label}{' '}
              {pendingRoleChange.affected.length === 1 ? 'assignment' : 'assignments'} on this
              track to {pendingRoleChange.newRole.label}. Anyone staffed under a different role on
              this track is left alone.
            </>
          }
          confirmLabel="Change role"
          variant="primary"
          onConfirm={() => applyDefaultRoleChange(
            pendingRoleChange.track, pendingRoleChange.newRole, pendingRoleChange.affected,
          )}
          onClose={() => {
            pendingRoleChange.resolve()
            setPendingRoleChange(null)
          }}
        />
      )}
    </div>
  )
}
