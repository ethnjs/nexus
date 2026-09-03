"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError, MembershipFull, Role, TournamentShift,
  membershipsApi, rolesApi, tournamentShiftsApi,
} from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { MemberSections } from "@/components/tournament/sections/MemberSections";
import { IconArrowLeft, IconLock } from "@/components/ui/Icons";

/**
 * One member's whole record for this tournament.
 *
 * Deliberately not display-config-driven: the panel is the configurable,
 * skimmable view of a member, and this is the one place that shows
 * everything regardless of what any viewer has hidden. That's why the fetch
 * passes no `surface` — nothing is stripped server-side, and
 * `sectionConfig={null}` renders every section in default order.
 *
 * Reachable by anyone with manage_members, and by the member themselves
 * (the API enforces both, see get_membership). A self-viewer gets the same
 * sections minus the coordinator notes, which the server withholds.
 */
export default function MemberPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const membershipId = Number(params.membershipId);

  const { selectedTournament } = useTournament();
  const { canManageMembers, membershipLoading, canTouchRole, canEditMember } = useMemberRoleLock();

  const [full, setFull] = useState<MembershipFull | null>(null);
  const [shifts, setShifts] = useState<TournamentShift[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!Number.isFinite(tournamentId) || !Number.isFinite(membershipId)) return;
    membershipsApi.get(tournamentId, membershipId)
      .then(setFull)
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, "Failed to load member.")));
    tournamentShiftsApi.list(tournamentId).then(setShifts).catch(() => {});
  }, [tournamentId, membershipId]);

  // The catalog is only the *pickable* roles — the ones a member already
  // holds ride on the membership itself. So it's needed only for the edit
  // popover, and the route is manage_members/manage_roles gated anyway.
  useEffect(() => {
    if (!canManageMembers) return;
    rolesApi.list(tournamentId).then(setAllRoles).catch(() => setAllRoles([]));
  }, [tournamentId, canManageMembers]);

  if (error) {
    return (
      <div>
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title={error.status === 403 ? "No access" : "Member not found"}
            description={
              error.status === 403
                ? "You can only view your own member page in this tournament."
                : "This member may have been removed from the tournament."
            }
          />
        </Card>
      </div>
    );
  }

  if (!full || membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  // Two separate gates, and both have to hold. canEditMember exempts the
  // actor themselves — right for "can I act on this row", wrong here, since
  // a member on their own page still can't hand themselves a role.
  const rolesLocked = !canManageMembers || !canEditMember(full);

  return (
    // Same 900px column /profile/[id] reads in: it's the same kind of page —
    // one person's record, top to bottom — and the section cards are built
    // for that measure, not for a full-width dashboard table.
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      {/* Only offered to someone who can actually open the roster — a member
          reached their own page from somewhere else entirely. */}
      {canManageMembers && (
        <div style={{ marginBottom: "16px" }}>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/members`)}
          >
            <IconArrowLeft size={14} /> Members
          </Button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <ProfileHeader user={full.user} />
        <MemberSections
          tournamentId={tournamentId}
          membership={full}
          sectionConfig={null}
          shifts={shifts}
          allRoles={allRoles}
          canTouchRole={canTouchRole}
          rolesLocked={rolesLocked}
          collectIsOver18={!!selectedTournament?.collect_is_over_18}
          collectIsOver21={!!selectedTournament?.collect_is_over_21}
          onRolesUpdated={(updated) =>
            setFull((f) => (f ? { ...f, roles: updated.roles } : f))
          }
        />
      </div>
    </div>
  );
}
