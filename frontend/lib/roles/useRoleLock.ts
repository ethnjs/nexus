"use client";

import { useCallback, useMemo } from "react";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import { Role } from "@/lib/api";

export interface RoleLock {
  canManageRoles: boolean;
  /** canManageRoles minus archived — creating/applying a template is blocked read-only, unlike editing an existing role. */
  canCreateRoles: boolean;
  membershipLoading: boolean;
  /** Why a role can't be edited, or null if it's editable. */
  lockReason: (role: Role) => string | null;
  isLocked: (role: Role) => boolean;
  /** Lowest (= highest-authority) rank among the current user's own roles, or null if they hold none. */
  ownRank: number | null;
  /** Owner and platform admins bypass rank-bound checks entirely — same rationale as the backend's validate_rank_bound/validate_role_action. */
  bypassRankBound: boolean;
}

export function useRoleLock(): RoleLock {
  const { user: currentUser } = useAuth();
  const { isArchived } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageRoles = isAdmin || isOwner || hasPermission("manage_roles");
  const canCreateRoles = canManageRoles && !isArchived;

  const ownRank = useMemo(() => {
    if (!membership || membership.roles.length === 0) return null;
    return Math.min(...membership.roles.map((r) => r.rank));
  }, [membership]);

  const lockReason = useCallback((role: Role): string | null => {
    if (isArchived) return "This tournament is archived — roles cannot be changed anymore.";
    if (!canManageRoles) return "You don't have permission to manage roles.";
    if (isAdmin || isOwner) return null;
    if (ownRank === null) return "You don't hold any role here, so you can't manage roles.";
    if (role.rank <= ownRank) return "This role is at or above your own rank — you can't edit roles that outrank or tie your highest role.";
    return null;
  }, [isArchived, canManageRoles, isAdmin, isOwner, ownRank]);

  const isLocked = useCallback((role: Role) => lockReason(role) !== null, [lockReason]);

  return {
    canManageRoles, canCreateRoles, membershipLoading, lockReason, isLocked,
    ownRank, bypassRankBound: isAdmin || isOwner,
  };
}
