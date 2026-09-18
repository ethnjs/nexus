"use client";

import {
  IconHome,
  IconAssignments,
  IconEvents,
  IconForms,
  IconMembers,
  IconSettings,
  IconCalendar,
  IconBuilding,
} from "@/components/ui/Icons";
import { Sidebar, SidebarItem } from "@/components/layout/Sidebar";
import { TournamentDropdown } from "@/components/layout/TournamentDropdown";
import { Permission } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";

interface TournamentSidebarProps {
  onExpandedChange?: (expanded: boolean) => void;
  tournamentId: string | number;
}

/**
 * The tournament rail's item set. Sheets is deliberately absent — the route
 * still exists but the feature is deprecated, so the nav entry went rather
 * than being left as a dead link.
 */
export function TournamentSidebar({ onExpandedChange, tournamentId }: TournamentSidebarProps) {
  const base = `/dashboard/tournaments/${tournamentId}`;
  const settingsBase = `${base}/settings`;

  const { user: currentUser } = useAuth();
  const { membership, hasPermission } = useMyMembership();

  // A site admin or the tournament's owner bypasses every per-permission
  // check; everyone else needs the specific grant.
  const isPrivileged = currentUser?.role === "admin" || !!membership?.is_owner;
  const can = (permission: Permission) => isPrivileged || hasPermission(permission);

  const canManageEvents = can("manage_events");
  const canManageMembers = can("manage_members");
  const canManageTournament = can("manage_tournament");

  const items: SidebarItem[] = [
    { key: "overview",    href: `${base}/overview`,    icon: <IconHome />,             label: "Overview" },
    ...(canManageEvents ? [
      { key: "events",    href: `${base}/events`,      icon: <IconEvents />, label: "Events" },
      { key: "shifts",    href: `${base}/shifts`,      icon: <IconCalendar size={17} />, label: "Shifts" },
      { key: "buildings", href: `${base}/buildings`,   icon: <IconBuilding size={17} />, label: "Buildings" },
    ] : []),
    // Matches the page's own view gate: staffing is part of reading the event
    // (manage_events) or deciding who does it (manage_members).
    ...(canManageEvents || canManageMembers ? [
      { key: "assignments", href: `${base}/assignments`, icon: <IconAssignments />, label: "Assignments" },
    ] : []),
    ...(can("manage_forms") ? [
      { key: "forms",     href: `${base}/forms`,       icon: <IconForms />,  label: "Forms" },
    ] : []),
    ...(canManageMembers ? [
      { key: "members",   href: `${base}/members`,     icon: <IconMembers />, label: "Members" },
    ] : []),
    {
      key: "settings",
      match: settingsBase,
      icon: <IconSettings size={18} />,
      label: "Settings",
      subitems: [
        { href: `${settingsBase}/general`, label: "General" },
        ...(can("manage_roles")   ? [{ href: `${settingsBase}/roles`,     label: "Roles" }]     : []),
        ...(can("manage_invites") ? [{ href: `${settingsBase}/invites`,   label: "Invites" }]   : []),
        ...(canManageTournament   ? [{ href: `${settingsBase}/audit-log`, label: "Audit Log" }] : []),
      ],
    },
  ];

  return (
    <Sidebar
      items={items}
      onExpandedChange={onExpandedChange}
      // Mobile only — the drawer is where the switcher goes when the Topbar
      // is too narrow for it. Sidebar hides this slot on desktop.
      navHeader={<TournamentDropdown tournamentId={tournamentId} fullWidth />}
    />
  );
}
