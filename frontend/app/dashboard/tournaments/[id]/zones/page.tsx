"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { useRegisterBoardDnd } from "@/components/tournament/assignments/BoardDnd";
import { RolePillMenu } from "@/components/tournament/assignments/RolePillMenu";
import { useMemberBelt } from "@/components/tournament/assignments/useMemberBelt";
import { EVENT_PANEL_WIDTH, EventPanel } from "@/components/tournament/events/EventPanel";
import { MEMBER_PANEL_WIDTH, MemberPanel } from "@/components/tournament/members/MemberPanel";
import { TrackSummary } from "@/components/tournament/TrackSummary";
import { AddZoneModal } from "@/components/tournament/zones/AddZoneModal";
import { DayStatusDot } from "@/components/tournament/zones/DayStatusDot";
import { ZoneCard } from "@/components/tournament/zones/ZoneCard";
import { ZoneContentsTable } from "@/components/tournament/zones/ZoneContentsTable";
import { ZoneLocationsList, ZonePanelDropZone } from "@/components/tournament/zones/ZonesSidePanel";
import {
  parseZoneDragId,
  parseZoneDropId,
  ruleFromKey,
  ZONE_PANEL_DROP_ID,
  zoneDragId,
} from "@/components/tournament/zones/zoneDnd";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Dropdown } from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconLocation, IconLock, IconPlus } from "@/components/ui/Icons";
import { LoadingState } from "@/components/ui/LoadingState";
import { MasonryGrid } from "@/components/ui/MasonryGrid";
import { TabStrip } from "@/components/ui/TabStrip";
import {
  ApiError,
  buildingsApi,
  type CanonicalEvent,
  canonicalEventsApi,
  type MembershipFull,
  membersApi,
  type Role,
  rolesApi,
  type TournamentBuilding,
  type TournamentEvent,
  type TournamentShift,
  type TournamentTrack,
  tournamentEventsApi,
  tournamentShiftsApi,
  tournamentTracksApi,
  type Zone,
  type ZoneAssignment,
  type ZoneCoverage,
  type ZoneMember,
  zoneAssignmentsApi,
  zonesApi,
} from "@/lib/api";
import { type AssignmentRole, roleSummary, sameRole } from "@/lib/assignments/lanes";
import { ZONES_MEMBERS } from "@/lib/displayConfigSurfaces";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { trackDetail } from "@/lib/eventTrackDetails";
import { personName, userName } from "@/lib/personDisplay";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { useAuth } from "@/lib/useAuth";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { useMyMembership } from "@/lib/useMyMembership";
import { replaceSearchParams, useInitialPanelId, usePanelUrlSync } from "@/lib/usePanelUrl";
import { useToast } from "@/lib/useToast";
import { useTournament } from "@/lib/useTournament";
import {
  memberDayStatus,
  ruleInput,
  ruleKey,
  ruleLabel,
  ruleOwners,
  zoneContents,
  zoneTargets,
} from "@/lib/zones";

const NO_ZONE_ROLE = "__none__";
// The assignments board's belt width, so its member cards wrap the same way.
const LIST_PANEL_WIDTH = 340;

export default function ZonesPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const isPrivileged = currentUser?.role === "admin" || !!membership?.is_owner;
  const canManageEvents = isPrivileged || hasPermission("manage_events");
  const canManageTournament = isPrivileged || hasPermission("manage_tournament");
  const canManageMembers = isPrivileged || hasPermission("manage_members");
  const { isArchived, archivedReason } = useArchiveLock();
  const { tracks, selectedTournament, setSelectedTournament } = useTournament();
  const { show } = useToast();

  const days = useMemo(() => tracks.filter((t) => t.is_primary), [tracks]);

  // Mirrored into ?track= so a reload comes back to the same day. A stale id
  // falls back to the first day.
  const searchParams = useSearchParams();
  const [pickedTrackId, setPickedTrackId] = useState<number | null>(
    () => Number(searchParams.get("track")) || null,
  );
  const activeTrackId =
    pickedTrackId !== null && days.some((t) => t.id === pickedTrackId)
      ? pickedTrackId
      : (days[0]?.id ?? null);
  const activeTrack = days.find((t) => t.id === activeTrackId) ?? null;

  // Memoised: CollapsibleHeader re-registers the Topbar's copy whenever this
  // identity changes.
  const headerTabs = useMemo(() => days.map((t) => ({ key: String(t.id), label: t.name })), [days]);
  const pickTab = useCallback((key: string) => {
    setPickedTrackId(Number(key));
    const params = new URLSearchParams(window.location.search);
    params.set("track", key);
    replaceSearchParams(params);
  }, []);

  const [coverage, setCoverage] = useState<ZoneCoverage | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!canManageEvents || activeTrackId === null) return;
    let cancelled = false;
    setLoadError(undefined);
    zonesApi
      .list(tournamentId, activeTrackId)
      .then((data) => {
        if (!cancelled) setCoverage(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "Failed to load zones.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, activeTrackId, canManageEvents]);

  // Roles need manage_members, manage_roles or manage_forms; without them the
  // picker just has no options to show.
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => {
    if (!canManageEvents) return;
    rolesApi
      .list(tournamentId)
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [tournamentId, canManageEvents]);

  async function setZoneRole(track: TournamentTrack, roleId: number | null) {
    try {
      const saved = await tournamentTracksApi.update(tournamentId, track.id, {
        zone_default_role_id: roleId,
      });
      if (selectedTournament) {
        setSelectedTournament({
          ...selectedTournament,
          tracks: selectedTournament.tracks.map((t) => (t.id === saved.id ? saved : t)),
        });
      }
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to set the zone role.", "error");
    }
  }

  const [buildings, setBuildings] = useState<TournamentBuilding[]>([]);
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  useEffect(() => {
    if (!canManageEvents) return;
    buildingsApi
      .list(tournamentId)
      .then(setBuildings)
      .catch(() => setBuildings([]));
    tournamentEventsApi
      .list(tournamentId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [tournamentId, canManageEvents]);
  const dayBuildings = useMemo(
    () => buildings.filter((b) => activeTrackId !== null && b.track_ids.includes(activeTrackId)),
    [buildings, activeTrackId],
  );
  const dayEvents = useMemo(
    () => events.filter((e) => activeTrackId !== null && trackDetail(e, activeTrackId)),
    [events, activeTrackId],
  );
  const targets = useMemo(() => zoneTargets(dayBuildings, dayEvents), [dayBuildings, dayEvents]);

  // Staffing zones is manage_members, like the routes behind it.
  const [members, setMembers] = useState<MembershipFull[]>([]);
  const [assignments, setAssignments] = useState<ZoneAssignment[]>([]);
  useEffect(() => {
    if (!canManageMembers) return;
    membersApi
      .list(tournamentId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [tournamentId, canManageMembers]);
  useEffect(() => {
    if (!canManageMembers || activeTrackId === null) return;
    zoneAssignmentsApi
      .list(tournamentId, { trackId: activeTrackId })
      .then(setAssignments)
      .catch(() => setAssignments([]));
  }, [tournamentId, activeTrackId, canManageMembers]);
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const reloadCoverage = useCallback(async () => {
    if (activeTrackId === null) return;
    setCoverage(await zonesApi.list(tournamentId, activeTrackId));
  }, [tournamentId, activeTrackId]);

  const writeRules = (zone: Zone, rules: ZoneMember[]) =>
    zonesApi.update(tournamentId, zone.id, { members: rules });

  /** Moves the rule here from whichever zone held it. Throws so the picker can show why. */
  async function addRule(zone: Zone, rule: ZoneMember) {
    const key = ruleKey(rule);
    const owner = owners.get(key);
    if (owner?.id === zone.id) return;
    const before = zone.members.map(ruleInput);
    const ownerBefore = owner?.members.map(ruleInput) ?? [];
    try {
      if (owner) {
        await writeRules(
          owner,
          ownerBefore.filter((r) => ruleKey(r) !== key),
        );
      }
      await writeRules(zone, [...before, rule]);
    } finally {
      await reloadCoverage().catch(() => {});
    }
    if (owner) {
      show(`Moved from ${owner.name} to ${zone.name}`, "success", {
        label: "Undo",
        onClick: () => void undoMove(zone, before, owner, ownerBefore),
      });
    }
  }

  async function undoMove(
    zone: Zone,
    before: ZoneMember[],
    owner: Zone,
    ownerBefore: ZoneMember[],
  ) {
    try {
      // This zone first, so the rule is free before the other zone takes it back.
      await writeRules(zone, before);
      await writeRules(owner, ownerBefore);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to undo.", "error");
    }
    await reloadCoverage().catch(() => {});
  }

  async function removeRule(zone: Zone, key: string) {
    try {
      await writeRules(
        zone,
        zone.members.map(ruleInput).filter((r) => ruleKey(r) !== key),
      );
      await reloadCoverage();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to remove.", "error");
    }
  }

  async function renameZone(zone: Zone, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === zone.name) return;
    const saved = await zonesApi.update(tournamentId, zone.id, { name: trimmed });
    setCoverage((cur) =>
      cur
        ? {
            ...cur,
            zones: cur.zones
              .map((z) => (z.id === saved.id ? saved : z))
              .sort((a, b) => a.name.localeCompare(b.name)),
          }
        : cur,
    );
  }

  async function addMember(zone: Zone, member: MembershipFull) {
    const created = await zoneAssignmentsApi.create(tournamentId, {
      zone_id: zone.id,
      membership_id: member.id,
    });
    setAssignments((cur) => [...cur, created]);
  }

  /** A member's rows in a zone, one per role. */
  const rowsFor = (zoneId: number, membershipId: number) =>
    assignments.filter((a) => a.zone_id === zoneId && a.member.membership_id === membershipId);

  async function deleteRow(id: number) {
    await zoneAssignmentsApi.delete(tournamentId, id);
    setAssignments((cur) => cur.filter((a) => a.id !== id));
  }

  async function addRole(zone: Zone, membershipId: number, role: AssignmentRole) {
    if (role.id === null) return;
    const created = await zoneAssignmentsApi.create(tournamentId, {
      zone_id: zone.id,
      membership_id: membershipId,
      role_id: role.id,
    });
    setAssignments((cur) => [...cur, created]);
  }

  async function removeMember(zone: Zone, membershipId: number) {
    try {
      for (const row of rowsFor(zone.id, membershipId)) await deleteRow(row.id);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to remove.", "error");
    }
  }

  /** Replaces the member's roles in this zone with `role`. */
  async function pickRole(zone: Zone, membershipId: number, role: AssignmentRole) {
    const rows = rowsFor(zone.id, membershipId);
    try {
      if (!rows.some((r) => sameRole(r.role, role))) await addRole(zone, membershipId, role);
      for (const row of rows.filter((r) => !sameRole(r.role, role))) await deleteRow(row.id);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to change the role.", "error");
    }
  }

  /** Moves a member to another zone in the same roles. */
  async function moveMember(from: Zone, to: Zone, membershipId: number) {
    const rows = rowsFor(from.id, membershipId);
    const there = rowsFor(to.id, membershipId);
    try {
      for (const row of rows) {
        if (!there.some((r) => sameRole(r.role, row.role))) {
          await addRole(to, membershipId, row.role);
        }
      }
      for (const row of rows) await deleteRow(row.id);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to move.", "error");
    }
  }

  async function toggleRole(zone: Zone, membershipId: number, role: AssignmentRole) {
    const row = rowsFor(zone.id, membershipId).find((r) => sameRole(r.role, role));
    try {
      if (row) await deleteRow(row.id);
      else await addRole(zone, membershipId, role);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to change the role.", "error");
    }
  }

  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Zone | null>(null);

  // Until the new day's zones arrive, the previous day's are still in state.
  const dayCoverage = coverage?.track_id === activeTrackId ? coverage : null;
  const zones = dayCoverage?.zones ?? [];
  const owners = useMemo(() => ruleOwners(dayCoverage?.zones ?? []), [dayCoverage]);
  const dayAssignments = useMemo(
    () => assignments.filter((a) => a.track_id === activeTrackId),
    [assignments, activeTrackId],
  );

  // ── the event panel ───────────────────────────────────────────────────
  const [focusedEventId, setFocusedEventId] = useState<number | null>(useInitialPanelId("event"));
  usePanelUrlSync("event", focusedEventId);
  const focusedEvent = events.find((e) => e.id === focusedEventId) ?? null;
  const [allShifts, setAllShifts] = useState<TournamentShift[]>([]);
  const [canonicalEvents, setCanonicalEvents] = useState<CanonicalEvent[]>([]);
  const [panelDataLoaded, setPanelDataLoaded] = useState(false);
  useEffect(() => {
    if (focusedEventId === null || panelDataLoaded) return;
    setPanelDataLoaded(true);
    tournamentShiftsApi
      .list(tournamentId)
      .then(setAllShifts)
      .catch(() => {});
    canonicalEventsApi
      .list()
      .then(setCanonicalEvents)
      .catch(() => {});
  }, [focusedEventId, panelDataLoaded, tournamentId]);

  // Prev and next step through the open event's zone, else the whole day.
  const panelList = useMemo(() => {
    const zone = dayCoverage?.zones.find(
      (z) => focusedEventId !== null && z.event_ids.includes(focusedEventId),
    );
    return dayEvents
      .filter((e) => !zone || zone.event_ids.includes(e.id))
      .sort((a, b) => eventNameWithDivision(a).localeCompare(eventNameWithDivision(b)));
  }, [dayCoverage, dayEvents, focusedEventId]);

  // ── the side panel ────────────────────────────────────────────────────
  const [sideTab, setSideTab] = useState<"locations" | "members">("locations");
  const {
    belt,
    headerActions: beltHeaderActions,
    renderList: renderBelt,
    modals: beltModals,
  } = useMemberBelt({
    tournamentId,
    enabled: canManageMembers,
    surface: ZONES_MEMBERS,
    tracks,
    activeTrackId,
    filterToTab: false,
    members,
    refetchKey: assignments,
    roleCatalog: roles,
  });

  // One detail panel at a time beside the list: a member's or an event's.
  const [focusedMemberId, setFocusedMemberId] = useState<number | null>(
    useInitialPanelId("member"),
  );
  usePanelUrlSync("member", focusedMemberId);
  const focusedMember =
    focusedMemberId === null ? null : (membersById.get(focusedMemberId) ?? null);
  const openMember = useCallback((id: number) => {
    setFocusedEventId(null);
    setFocusedMemberId(id);
  }, []);
  const openEvent = useCallback((id: number) => {
    setFocusedMemberId(null);
    setFocusedEventId(id);
  }, []);
  const { canTouchRole, canEditMember } = useMemberRoleLock();

  const { setPanel, clearPanel } = useSetLayoutPanel();
  useEffect(() => clearPanel, [clearPanel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel's handlers are recreated each render
  useEffect(() => {
    if (!canManageEvents || !activeTrack) return;
    const tab = canManageMembers ? sideTab : "locations";
    const index = focusedEvent ? panelList.findIndex((e) => e.id === focusedEvent.id) : -1;
    const memberIndex = focusedMember ? belt.findIndex((m) => m.id === focusedMember.id) : -1;
    const detailWidth = focusedMember ? MEMBER_PANEL_WIDTH : focusedEvent ? EVENT_PANEL_WIDTH : 0;
    setPanel(
      <div style={{ display: "flex", height: "100%" }}>
        <DockedPanel
          width={LIST_PANEL_WIDTH}
          headerActions={tab === "members" ? beltHeaderActions : undefined}
        >
          <ZonePanelDropZone>
            {canManageMembers && (
              <div style={{ padding: "12px 12px 0" }}>
                <TabStrip
                  tabs={[
                    { key: "locations", label: "Locations" },
                    { key: "members", label: "Members" },
                  ]}
                  activeKey={tab}
                  onChange={setSideTab}
                />
              </div>
            )}
            {tab === "members" ? (
              renderBelt({ focusedId: focusedMemberId, allShifts, onOpen: openMember })
            ) : (
              <ZoneLocationsList
                trackId={activeTrack.id}
                buildings={dayBuildings}
                events={dayEvents}
                targets={targets}
                zones={dayCoverage?.zones ?? []}
                owners={owners}
                focusedEventId={focusedEventId}
                locked={isArchived}
                onOpenEvent={openEvent}
              />
            )}
          </ZonePanelDropZone>
        </DockedPanel>
        {focusedMember && (
          <MemberPanel
            key={focusedMember.id}
            tournamentId={tournamentId}
            membershipId={focusedMember.id}
            allRoles={roles}
            shifts={allShifts}
            tracks={tracks}
            canTouchRole={canTouchRole}
            canEditMember={canEditMember}
            collectIsOver18={!!selectedTournament?.collect_is_over_18}
            collectIsOver21={!!selectedTournament?.collect_is_over_21}
            isArchived={isArchived}
            isSelf={currentUser?.id === focusedMember.user.id}
            onClose={() => setFocusedMemberId(null)}
            // Roles only: the roles PATCH returns none of the built groups.
            onUpdated={(updated) =>
              setMembers((cur) =>
                cur.map((m) => (m.id === updated.id ? { ...m, roles: updated.roles } : m)),
              )
            }
            onAssignmentsChanged={() => {}}
            onPrev={() => memberIndex > 0 && openMember(belt[memberIndex - 1].id)}
            onNext={() =>
              memberIndex >= 0 &&
              memberIndex < belt.length - 1 &&
              openMember(belt[memberIndex + 1].id)
            }
            hasPrev={memberIndex > 0}
            hasNext={memberIndex >= 0 && memberIndex < belt.length - 1}
          />
        )}
        {focusedEvent && !focusedMember && (
          <EventPanel
            key={focusedEvent.id}
            tournamentId={tournamentId}
            event={focusedEvent}
            locked={isArchived}
            canonicalEvents={canonicalEvents}
            allShifts={allShifts}
            tracks={tracks}
            buildings={buildings}
            roles={roles}
            onShiftCreated={(shift) => setAllShifts((prev) => [...prev, shift])}
            onBuildingSaved={(building) =>
              setBuildings((cur) =>
                cur.some((b) => b.id === building.id)
                  ? cur.map((b) => (b.id === building.id ? building : b))
                  : [...cur, building],
              )
            }
            onClose={() => setFocusedEventId(null)}
            onSaved={(next) => {
              setEvents((cur) => cur.map((e) => (e.id === next.id ? { ...e, ...next } : e)));
              // A new location can move the event between zones.
              void reloadCoverage().catch(() => {});
            }}
            onDeleted={(id) => {
              setEvents((cur) => cur.filter((e) => e.id !== id));
              setFocusedEventId(null);
              void reloadCoverage().catch(() => {});
            }}
            onPrev={() => index > 0 && openEvent(panelList[index - 1].id)}
            onNext={() =>
              index >= 0 && index < panelList.length - 1 && openEvent(panelList[index + 1].id)
            }
            hasPrev={index > 0}
            hasNext={index >= 0 && index < panelList.length - 1}
          />
        )}
      </div>,
      LIST_PANEL_WIDTH + detailWidth,
    );
  }, [
    canManageEvents,
    canManageMembers,
    activeTrack,
    sideTab,
    belt,
    beltHeaderActions,
    renderBelt,
    dayBuildings,
    dayEvents,
    targets,
    dayCoverage,
    owners,
    focusedEvent,
    focusedEventId,
    focusedMember,
    focusedMemberId,
    panelList,
    isArchived,
    canonicalEvents,
    allShifts,
    tracks,
    buildings,
    roles,
    setPanel,
  ]);

  // ── drag and drop ────────────────────────────────────────────────────
  // Onto a zone card: a location becomes a rule there (moved from any zone
  // that had it), a member is added in the day's zone role, and a member chip
  // moves with its roles. Onto the side panel: a chip leaves its zone.
  useRegisterBoardDnd("zones", {
    onDragEnd: ({ active, over }) => {
      const drag = parseZoneDragId(String(active.id));
      if (!drag || !over) return;
      const overId = String(over.id);
      const fromZone =
        drag.kind === "rule-chip" || drag.kind === "member-chip"
          ? zones.find((z) => z.id === drag.zoneId)
          : undefined;

      if (overId === ZONE_PANEL_DROP_ID) {
        if (drag.kind === "rule-chip" && fromZone) void removeRule(fromZone, drag.ruleKey);
        if (drag.kind === "member-chip" && fromZone) void removeMember(fromZone, drag.membershipId);
        return;
      }

      const zone = zones.find((z) => z.id === parseZoneDropId(overId));
      if (!zone || zone.id === fromZone?.id) return;
      const fail = (err: unknown) =>
        show(err instanceof ApiError ? err.message : "Failed to add.", "error");

      if (drag.kind === "target" || drag.kind === "rule-chip") {
        const rule = ruleFromKey(drag.ruleKey);
        if (rule) addRule(zone, rule).catch(fail);
      } else if (drag.kind === "member") {
        const member = membersById.get(drag.membershipId);
        if (member && rowsFor(zone.id, member.id).length === 0) addMember(zone, member).catch(fail);
      } else if (fromZone) {
        void moveMember(fromZone, zone, drag.membershipId);
      }
    },
    renderOverlay: (activeId) => {
      const drag = parseZoneDragId(activeId);
      if (!drag) return null;
      let label: string | undefined;
      if (drag.kind === "target" || drag.kind === "rule-chip") {
        label = targets.find((t) => ruleKey(t.rule) === drag.ruleKey)?.label;
      } else {
        const member = membersById.get(drag.membershipId);
        label = member ? userName(member.user) : undefined;
      }
      if (!label) return null;
      return (
        <div
          style={{
            padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-strong)",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      );
    },
  });

  if (membershipLoading) {
    return <LoadingState />;
  }

  if (!canManageEvents) {
    return (
      <div>
        <CollapsibleHeader heading="Zones" />
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

  if (days.length === 0) {
    return (
      <div>
        <CollapsibleHeader heading="Zones" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLocation size={28} />}
            title="No competition days"
            description="Add a competition day in settings before adding zones."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* One day: the header collapses to the title alone. */}
      <CollapsibleHeader
        heading="Zones"
        tabs={days.length > 1 ? headerTabs : undefined}
        activeKey={activeTrackId === null ? undefined : String(activeTrackId)}
        onChange={pickTab}
      />

      {loadError && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            marginBottom: "12px",
          }}
        >
          {loadError}
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        {activeTrack ? <TrackSummary track={activeTrack} /> : <span />}
        {activeTrack && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--color-text-secondary)",
              }}
            >
              Zone role
            </span>
            <Dropdown
              value={
                activeTrack.zone_default_role_id === null
                  ? NO_ZONE_ROLE
                  : String(activeTrack.zone_default_role_id)
              }
              onChange={(v) => setZoneRole(activeTrack, v === NO_ZONE_ROLE ? null : Number(v))}
              options={[
                { value: NO_ZONE_ROLE, label: "None" },
                ...roles.map((r) => ({ value: String(r.id), label: r.label })),
              ]}
              locked={isArchived || !canManageTournament}
              variant="secondary"
              size="md"
              width={180}
            />
            {!isArchived && zones.length > 0 && (
              <Button type="button" variant="primary" size="md" onClick={() => setAdding(true)}>
                <IconPlus size={14} /> New zone
              </Button>
            )}
          </div>
        )}
      </div>

      {dayCoverage === null && !loadError ? (
        <LoadingState />
      ) : zones.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLocation size={28} />}
            title="No zones yet"
            description="Group buildings, floors, rooms and events into zones, then add the members who cover them."
            action={
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setAdding(true)}
                disabled={isArchived}
                title={archivedReason}
              >
                <IconPlus size={12} /> New zone
              </Button>
            }
          />
        </Card>
      ) : (
        <MasonryGrid minColumnWidth={360} maxColumns={2} gap={16}>
          {zones.map((zone) => {
            const own = new Set(zone.members.map(ruleKey));
            const zoneAssignments = dayAssignments.filter((a) => a.zone_id === zone.id);
            const assigned = new Set(zoneAssignments.map((a) => a.member.membership_id));
            return (
              <ZoneCard
                key={zone.id}
                zone={zone}
                locked={isArchived}
                lockedReason={archivedReason}
                locations={zone.members.map((rule) => ({
                  key: ruleKey(rule),
                  dragId: zoneDragId({
                    kind: "rule-chip",
                    zoneId: zone.id,
                    ruleKey: ruleKey(rule),
                  }),
                  label: ruleLabel(rule, dayBuildings, dayEvents),
                }))}
                locationOptions={targets
                  .filter((t) => !own.has(ruleKey(t.rule)))
                  .map((t) => {
                    const owner = owners.get(ruleKey(t.rule));
                    return {
                      key: ruleKey(t.rule),
                      value: t.rule,
                      label: t.label,
                      note: owner ? `In ${owner.name}` : null,
                      group: t.group,
                      searchText: t.searchText,
                    };
                  })}
                contents={
                  activeTrackId !== null && (
                    <ZoneContentsTable
                      contents={zoneContents(zone, owners, dayBuildings, dayEvents, activeTrackId)}
                      onOpenEvent={openEvent}
                    />
                  )
                }
                members={
                  canManageMembers && activeTrack
                    ? memberChips(zoneAssignments).map(({ membershipId, ref, roles: held }) => {
                        const member = membersById.get(membershipId);
                        return {
                          key: membershipId,
                          dragId: zoneDragId({
                            kind: "member-chip",
                            zoneId: zone.id,
                            membershipId,
                          }),
                          label: personName(ref),
                          icon: member ? (
                            <DayStatusDot
                              status={memberDayStatus(member, activeTrack.id)}
                              dayName={activeTrack.name}
                            />
                          ) : undefined,
                          trailing: isArchived ? (
                            <span style={{ color: "var(--color-text-secondary)" }}>
                              {roleSummary(held)}
                            </span>
                          ) : (
                            <RolePillMenu
                              roles={held}
                              roleCatalog={roles}
                              onPickRole={(role) => void pickRole(zone, membershipId, role)}
                              onToggleRole={(role) => void toggleRole(zone, membershipId, role)}
                            />
                          ),
                        };
                      })
                    : null
                }
                memberOptions={
                  activeTrack
                    ? members
                        .filter((m) => !assigned.has(m.id))
                        .map((m) => {
                          const elsewhere = dayAssignments
                            .filter((a) => a.member.membership_id === m.id)
                            .map((a) => a.zone_name);
                          return {
                            key: m.id,
                            value: m,
                            label: userName(m.user),
                            note: elsewhere.length > 0 ? `In ${elsewhere.join(", ")}` : null,
                            badge: (
                              <DayStatusDot
                                status={memberDayStatus(m, activeTrack.id)}
                                dayName={activeTrack.name}
                              />
                            ),
                            searchText: `${userName(m.user)} ${m.user.email}`,
                          };
                        })
                        .sort((a, b) => a.label.localeCompare(b.label))
                    : []
                }
                onRename={(name) => renameZone(zone, name)}
                onDelete={() => setDeleteTarget(zone)}
                onAddLocation={(rule) => addRule(zone, rule)}
                onRemoveLocation={(key) => void removeRule(zone, String(key))}
                onAddMember={(member) => addMember(zone, member)}
                onRemoveMember={(key) => void removeMember(zone, Number(key))}
              />
            );
          })}
        </MasonryGrid>
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete ${deleteTarget.name}?`}
          description="The members covering it are taken off it, and its events go back to not being in a zone."
          confirmLabel="Delete"
          onConfirm={() => zonesApi.delete(tournamentId, deleteTarget.id)}
          onConfirmed={() => {
            setAssignments((cur) => cur.filter((a) => a.zone_id !== deleteTarget.id));
            void reloadCoverage().catch(() => {});
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {beltModals}

      {adding && activeTrackId !== null && (
        <AddZoneModal
          tournamentId={tournamentId}
          trackId={activeTrackId}
          onClose={() => setAdding(false)}
          onCreated={(created) =>
            setCoverage((cur) =>
              cur
                ? {
                    ...cur,
                    zones: [...cur.zones, created].sort((a, b) => a.name.localeCompare(b.name)),
                  }
                : cur,
            )
          }
        />
      )}
    </div>
  );
}

/** One chip per member, carrying every role they cover the zone in. */
function memberChips(rows: ZoneAssignment[]) {
  const byMember = new Map<number, ZoneAssignment[]>();
  for (const row of rows) {
    if (row.member.membership_id === null) continue;
    byMember.set(row.member.membership_id, [
      ...(byMember.get(row.member.membership_id) ?? []),
      row,
    ]);
  }
  return [...byMember.entries()]
    .map(([membershipId, held]) => ({
      membershipId,
      ref: held[0].member,
      roles: held.map((row) => row.role),
    }))
    .sort((a, b) => personName(a.ref).localeCompare(personName(b.ref)));
}
