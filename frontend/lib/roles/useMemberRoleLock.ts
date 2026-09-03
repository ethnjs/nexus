"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import { MembershipView, Role } from "@/lib/api";

export interface MemberRoleLock {
  canManageMembers: boolean;
  isArchived: boolean;
  membershipLoading: boolean;
  /** Lowest (= highest-authority) rank among the current user's own roles, or null if they hold none. */
  ownRank: number | null;
  /** Owner and platform admins bypass rank-bound checks entirely — mirrors validate_role_action's actor.id == owner_id / actor.role == "admin" bypass. */
  bypassRankBound: boolean;
  /** Whether `role` can be added to or removed from any member — mirrors validate_role_action check 1 (a role that ties or outranks the actor's own highest rank can never be touched, not even removing your own top role from yourself). */
  canTouchRole: (role: Role) => boolean;
  /**
   * Whether the actor can act on `target`'s membership row at all right
   * now — gates both role editing (RolesCell) and removing them from the
   * tournament, since the backend uses the same validate_member_target for
   * both. Archived tournaments are always locked. The tournament owner's
   * membership can never be a target for anyone but the owner/admin
   * themselves, even if the owner holds no role (rank is opt-in, so
   * relying on the rank comparison alone would leave an unranked owner
   * unprotected). Otherwise mirrors validate_member_target's rank check:
   * the target's highest-ranked role must not outrank the actor — ties are
   * fine, so peers at the same rank can still act on each other. Exempt
   * when target is the actor themselves (self is never blocked here; the
   * members page still routes a self-removal click to a different flow —
   * see the redirect modal on the members page — this hook only reports
   * backend-permission, not UI routing).
   */
  canEditMember: (target: MembershipView) => boolean;
}

export function useMemberRoleLock(): MemberRoleLock {
  const { user: currentUser } = useAuth();
  const { isArchived, selectedTournament } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageMembers = isAdmin || isOwner || hasPermission("manage_members");
  const bypassRankBound = isAdmin || isOwner;

  const ownRank = useMemo(() => {
    if (!membership?.roles?.length) return null;
    return Math.min(...membership.roles.map((r) => r.rank));
  }, [membership]);

  function canTouchRole(role: Role): boolean {
    if (bypassRankBound) return true;
    if (ownRank === null) return false;
    return role.rank > ownRank;
  }

  function canEditMember(target: MembershipView): boolean {
    if (isArchived) return false;
    if (bypassRankBound) return true;
    if (selectedTournament && target.user.id === selectedTournament.owner_id) return false;
    if (ownRank === null) return false;
    if (currentUser && target.user.id === currentUser.id) return true;
    if (!target.roles?.length) return true;
    const targetRank = Math.min(...target.roles.map((r) => r.rank));
    return targetRank >= ownRank;
  }

  return { canManageMembers, isArchived, membershipLoading, ownRank, bypassRankBound, canTouchRole, canEditMember };
}
