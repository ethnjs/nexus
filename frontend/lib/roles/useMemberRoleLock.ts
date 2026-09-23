"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import { MembershipView, Role } from "@/lib/api";
import { ARCHIVED_REASON } from "@/lib/useArchiveLock";

/** Why `canTouchRole` said no. One string for every caller: the rule is the
 *  same whoever the target is — including yourself, so don't special-case
 *  self with a "your own highest-ranked role" message. That reads as "only
 *  this one role of yours is protected" when in fact every role at or above
 *  your rank is, on anyone. */
export const RANK_LOCK_REASON = "You can't touch a role that ties or outranks your own highest role.";

/** Why `canEditMember` said no, for a control that stays visible and locked
 *  rather than disappearing — a missing button says nothing about why. */
export const OWNER_LOCK_REASON = "Only the tournament owner can change the owner's roles.";
export const MEMBER_RANK_LOCK_REASON = "This member's roles tie or outrank your own, so you can't change them.";
export const NO_RANK_LOCK_REASON = "You hold no ranked role, so you can't change anyone's roles.";

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
  /** The same rule as canEditMember, said out loud — undefined when editable. */
  memberLockReason: (target: MembershipView) => string | undefined;
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

  function memberLockReason(target: MembershipView): string | undefined {
    if (canEditMember(target)) return undefined;
    if (isArchived) return ARCHIVED_REASON;
    if (selectedTournament && target.user.id === selectedTournament.owner_id) return OWNER_LOCK_REASON;
    if (ownRank === null) return NO_RANK_LOCK_REASON;
    return MEMBER_RANK_LOCK_REASON;
  }

  return {
    canManageMembers, isArchived, membershipLoading, ownRank, bypassRankBound,
    canTouchRole, canEditMember, memberLockReason,
  };
}
