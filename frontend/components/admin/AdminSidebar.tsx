"use client";

import {
  IconHome,
  IconTrophy,
  IconMembers,
  IconEvents,
  IconSchool,
} from "@/components/ui/Icons";
import { Sidebar, SidebarItem } from "@/components/layout/Sidebar";
import { useAuth } from "@/lib/useAuth";

interface AdminSidebarProps {
  onExpandedChange?: (expanded: boolean) => void;
}

const ADMIN_ITEMS: SidebarItem[] = [
  { key: "tournaments",  href: "/dashboard/admin/tournaments",  icon: <IconTrophy />,  label: "Tournaments" },
  { key: "users",        href: "/dashboard/admin/users",        icon: <IconMembers />, label: "Users" },
  { key: "events",       href: "/dashboard/admin/events",       icon: <IconEvents />,  label: "Events" },
  { key: "universities", href: "/dashboard/admin/universities", icon: <IconSchool />,  label: "Universities" },
];

/**
 * The dashboard rail: Home for everyone, plus the platform-admin areas for
 * admins only. Flat by design — every admin area is one top-level entry, so
 * there are no groups and the rail never locks itself open.
 *
 * Hiding the entries is cosmetic; each admin page gates itself, and the
 * routes behind them are admin-only server-side.
 */
export function AdminSidebar({ onExpandedChange }: AdminSidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const items: SidebarItem[] = [
    // exact: every admin route lives under /dashboard, so a prefix match
    // would light Home up on all of them.
    { key: "home", href: "/dashboard", exact: true, icon: <IconHome />, label: "Home" },
    ...(isAdmin ? ADMIN_ITEMS : []),
  ];

  return <Sidebar items={items} onExpandedChange={onExpandedChange} />;
}
