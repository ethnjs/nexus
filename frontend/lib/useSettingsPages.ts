"use client";

import { useMemo } from "react";
import type { Permission } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";

export type SettingsPageKey = "general" | "roles" | "invites" | "audit-log";

export interface SettingsPage {
  key: SettingsPageKey;
  label: string;
  href: string;
}

/**
 * The tournament's settings pages this viewer may open, in nav order. One
 * list for the sidebar's Settings group and a folded settings header's
 * Topbar dropdown, so the two can never offer different pages. Memoised on
 * what decides it, so a caller can hand it straight to an effect's deps.
 */
export function useSettingsPages(tournamentId: string | number): SettingsPage[] {
  const { user: currentUser } = useAuth();
  const { membership, hasPermission } = useMyMembership();
  // A site admin or the tournament's owner bypasses every per-permission
  // check; everyone else needs the specific grant.
  const isPrivileged = currentUser?.role === "admin" || !!membership?.is_owner;
  const can = (permission: Permission) => isPrivileged || hasPermission(permission);
  const roles = can("manage_roles");
  const invites = can("manage_invites");
  const auditLog = can("manage_tournament");

  return useMemo(() => {
    const base = `/dashboard/tournaments/${tournamentId}/settings`;
    return [
      { key: "general", label: "General", href: `${base}/general` },
      ...(roles ? [{ key: "roles" as const, label: "Roles", href: `${base}/roles` }] : []),
      ...(invites ? [{ key: "invites" as const, label: "Invites", href: `${base}/invites` }] : []),
      ...(auditLog ? [{ key: "audit-log" as const, label: "Audit Log", href: `${base}/audit-log` }] : []),
    ];
  }, [tournamentId, roles, invites, auditLog]);
}
