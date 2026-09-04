"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError, MembershipView, Role, TournamentShift,
  asMembershipView, membersApi, rolesApi, tournamentShiftsApi,
} from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
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
 * Reachable by anyone with manage_members, and by the member themselves —
 * but by two different routes. GET /members/{id}/ is manage_members, full
 * stop; a member reads their own row from GET /members/me/, which returns
 * the same membership data plus what they may do here. Both satisfy
 * MembershipView, so the sections below don't care which one answered.
 */
export default function MemberPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const membershipId = Number(params.membershipId);

  const { selectedTournament } = useTournament();
  const { membership: me } = useMyMembership();
  const { canManageMembers, membershipLoading, canTouchRole, canEditMember } = useMemberRoleLock();

  const [full, setFull] = useState<MembershipView | null>(null);
  const [shifts, setShifts] = useState<TournamentShift[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  // Which route answers depends on who is asking, not on which page this is.
  // Wait for the provider before deciding: guessing wrong means a 403 the
  // member would see as "no access" to their own page.
  const isSelf = me?.id === membershipId;

  useEffect(() => {
    if (!Number.isFinite(tournamentId) || !Number.isFinite(membershipId)) return;
    if (membershipLoading) return;

    // A non-manager gets their own row and nobody else's, so anything but
    // their own id is refused here rather than fetched — otherwise /me would
    // happily render the caller's own record under someone else's URL.
    if (!canManageMembers && !isSelf) {
      setError(new ApiError(403, "You can only view your own member page."));
      return;
    }

    const load = canManageMembers
      ? membersApi.get(tournamentId, membershipId)
      : membersApi.getMe(tournamentId).then(asMembershipView);

    load
      .then((view) => {
        if (view) return setFull(view);
        // getMe answered with no membership row — the caller is not a member
        // of this tournament, so there is nothing of theirs to show.
        setError(new ApiError(403, "Not a member of this tournament."));
      })
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, "Failed to load member.")));
    // Reading the shift catalog only needs a membership now (the member edit
    // page needs it too), and all this sets is the availability timeline's
    // window — so there is no member-facing variant to ask for.
    tournamentShiftsApi.list(tournamentId).then(setShifts).catch(() => setShifts([]));
  }, [tournamentId, membershipId, canManageMembers, membershipLoading, isSelf]);

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
