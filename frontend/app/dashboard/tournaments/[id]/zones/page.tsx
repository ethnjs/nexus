"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TrackSummary } from "@/components/tournament/TrackSummary";
import { AddZoneModal } from "@/components/tournament/zones/AddZoneModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";
import { Dropdown } from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconLocation, IconLock, IconPlus } from "@/components/ui/Icons";
import { MasonryGrid } from "@/components/ui/MasonryGrid";
import { Spinner } from "@/components/ui/Spinner";
import {
  ApiError,
  type Role,
  rolesApi,
  type TournamentTrack,
  tournamentTracksApi,
  type ZoneCoverage,
  zonesApi,
} from "@/lib/api";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { replaceSearchParams } from "@/lib/usePanelUrl";
import { useToast } from "@/lib/useToast";
import { useTournament } from "@/lib/useTournament";

const NO_ZONE_ROLE = "__none__";

export default function ZonesPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const isPrivileged = currentUser?.role === "admin" || !!membership?.is_owner;
  const canManageEvents = isPrivileged || hasPermission("manage_events");
  const canManageTournament = isPrivileged || hasPermission("manage_tournament");
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
    zonesApi
      .list(tournamentId, activeTrackId)
      .then(setCoverage)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Failed to load zones."),
      );
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

  const [adding, setAdding] = useState(false);

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

  // Until the new day's zones arrive, the previous day's are still in state.
  const dayCoverage = coverage?.track_id === activeTrackId ? coverage : null;
  const zones = dayCoverage?.zones ?? [];

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
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
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
        <MasonryGrid minColumnWidth={360} gap={16}>
          {zones.map((zone) => (
            <Card key={zone.id} radius="lg" style={{ padding: "16px" }}>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {zone.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  marginTop: "4px",
                }}
              >
                {zone.event_ids.length} {zone.event_ids.length === 1 ? "event" : "events"}
              </div>
            </Card>
          ))}
        </MasonryGrid>
      )}

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
