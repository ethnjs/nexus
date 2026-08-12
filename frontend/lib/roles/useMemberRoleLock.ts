"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import { MembershipSlim, Role } from "@/lib/api";

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
  /** Whether the actor can edit `target`'s roles at all right now — archived tournaments are always locked; otherwise mirrors validate_role_action check 2 (the target's highest-ranked role must not outrank the actor — ties are fine, so peers at the same rank can still edit each other), exempt when target is the actor themselves. */
  canEditMember: (target: MembershipSlim) => boolean;
}

export function useMemberRoleLock(): MemberRoleLock {
  const { user: currentUser } = useAuth();
  const { isArchived } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageMembers = isAdmin || isOwner || hasPermission("manage_members");
  const bypassRankBound = isAdmin || isOwner;

  const ownRank = useMemo(() => {
    if (!membership || membership.roles.length === 0) return null;
    return Math.min(...membership.roles.map((r) => r.rank));
  }, [membership]);

  function canTouchRole(role: Role): boolean {
    if (bypassRankBound) return true;
    if (ownRank === null) return false;
    return role.rank > ownRank;
  }

  function canEditMember(target: MembershipSlim): boolean {
    if (isArchived) return false;
    if (bypassRankBound) return true;
    if (ownRank === null) return false;
    if (currentUser && target.user.id === currentUser.id) return true;
    if (target.roles.length === 0) return true;
    const targetRank = Math.min(...target.roles.map((r) => r.rank));
    return targetRank >= ownRank;
  }

  return { canManageMembers, isArchived, membershipLoading, ownRank, bypassRankBound, canTouchRole, canEditMember };
}
