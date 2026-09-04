"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconHome,
  IconEvents,
  IconForms,
  IconMembers,
  IconSettings,
  IconChevronDown,
  IconCalendar,
} from "@/components/ui/Icons";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";

export const COLLAPSED_W = 52;
export const EXPANDED_W  = 192;

// Sheets is deprecated and Assignments isn't built yet — both dropped from
// nav rather than left as dead links. Neither route was deleted, just the
// sidebar entry pointing at it.
const NAV_ITEMS = [
  { segment: "overview", icon: <IconHome />,  label: "Overview" },
  { segment: "events",   icon: <IconEvents />, label: "Events" },
  { segment: "shifts",   icon: <IconCalendar size={17} />, label: "Shifts" },
  { segment: "forms",    icon: <IconForms />,  label: "Forms" },
  { segment: "members",  icon: <IconMembers />, label: "Members" },
];

const SETTINGS_SUBITEMS = [
  { segment: "general",    label: "General" },
  { segment: "roles",      label: "Roles" },
  { segment: "invites",    label: "Invites" },
  { segment: "audit-log",  label: "Audit Log" },
];

interface SidebarProps {
  onExpandedChange?: (expanded: boolean) => void;
  tournamentId: string | number;
}

export function Sidebar({ onExpandedChange, tournamentId }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();
  const base = `/dashboard/tournaments/${tournamentId}`;
  const settingsBase = `${base}/settings`;
  const onSettingsRoute = pathname.startsWith(settingsBase);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission } = useMyMembership();
  const canManageRoles = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_roles");
  const canManageInvites = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_invites");
  const canManageTournament = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_tournament");
  const canManageMembers = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_members");
  const canManageEvents = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_events");
  const canManageForms = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_forms");
  const settingsSubitems = SETTINGS_SUBITEMS.filter(
    ({ segment }) =>
      (segment !== "roles" || canManageRoles) &&
      (segment !== "invites" || canManageInvites) &&
      (segment !== "tracks" || canManageTournament) &&
      (segment !== "audit-log" || canManageTournament)
  );
  const navItems = NAV_ITEMS.filter(
    ({ segment }) =>
      (segment !== "members" || canManageMembers) &&
      (segment !== "events" || canManageEvents) &&
      (segment !== "forms" || canManageForms)
  );
  // Locked open on settings routes — the sub-nav labels need to stay
  // readable without requiring the mouse to stay parked on the rail.
  const expanded = hovered || onSettingsRoute;
  const width = expanded ? EXPANDED_W : COLLAPSED_W;
  const showSettingsSub = expanded && (settingsOpen || onSettingsRoute);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  function handleMouseEnter() {
    setHovered(true);
  }

  function handleMouseLeave() {
    setHovered(false);
  }

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        width,
        height: "100vh",
        position: "fixed",
        top: 0,
        left: 0,
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        transition: "width 0.2s ease",
        overflow: "hidden",
        zIndex: 50,
      }}>
      {/* Header */}
      <div style={{
        height: "52px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        paddingLeft:  expanded ? "16px" : "0",
        paddingRight: expanded ? "16px" : "0",
      }}>
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          {expanded ? (
            <span style={{ fontFamily: "var(--font-serif)", fontSize: "15px", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--color-text-primary)", userSelect: "none", whiteSpace: "nowrap" }}>
              NEXUS
            </span>
          ) : (
            <span style={{ fontFamily: "var(--font-serif)", fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-primary)", userSelect: "none" }}>
              NX
            </span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav style={{
        display: "flex", flexDirection: "column", gap: "2px",
        flex: 1, padding: "10px 6px",
        alignItems: "stretch",
      }}>
        {navItems.map(({ segment, icon, label }) => {
          const href = `${base}/${segment}`;
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={segment}
              href={href}
              title={expanded ? undefined : label}
              style={{
                height: "38px",
                borderRadius: "var(--radius-md)",
                display: "flex", alignItems: "center",
                gap: "10px",
                paddingLeft:  "10px",
                paddingRight: "10px",
                justifyContent: "flex-start",
                width: "100%",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                background: isActive ? "var(--color-accent-subtle)" : "transparent",
                textDecoration: "none",
                position: "relative",
                transition: "background var(--transition-fast), color var(--transition-fast)",
                boxSizing: "border-box",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "var(--color-accent-subtle)";
                  (e.currentTarget as HTMLElement).style.color = "var(--color-text-primary)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--color-text-tertiary)";
                }
              }}
            >
              {isActive && (
                <div style={{
                  position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                  width: "3px", height: "20px",
                  background: "var(--color-accent)", borderRadius: "0 3px 3px 0",
                }} />
              )}
              {icon}
              {expanded && (
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
                  {label}
                </span>
              )}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          title={expanded ? undefined : "Settings"}
          style={{
            height: "38px",
            borderRadius: "var(--radius-md)",
            display: "flex", alignItems: "center",
            gap: "10px",
            paddingLeft: "10px",
            paddingRight: "10px",
            justifyContent: "flex-start",
            width: "100%",
            color: onSettingsRoute ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            background: onSettingsRoute ? "var(--color-accent-subtle)" : "transparent",
            position: "relative",
            transition: "background var(--transition-fast), color var(--transition-fast)",
            boxSizing: "border-box",
            border: "none",
            font: "inherit",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (!onSettingsRoute) {
              (e.currentTarget as HTMLElement).style.background = "var(--color-accent-subtle)";
              (e.currentTarget as HTMLElement).style.color = "var(--color-text-primary)";
            }
          }}
          onMouseLeave={(e) => {
            if (!onSettingsRoute) {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--color-text-tertiary)";
            }
          }}
        >
          {onSettingsRoute && (
            <div style={{
              position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
              width: "3px", height: "20px",
              background: "var(--color-accent)", borderRadius: "0 3px 3px 0",
            }} />
          )}
          <IconSettings size={18} />
          {expanded && (
            <>
              <span style={{
                flex: 1, textAlign: "left",
                fontFamily: "var(--font-sans)", fontSize: "13px",
                fontWeight: onSettingsRoute ? 600 : 400, whiteSpace: "nowrap", letterSpacing: "0.01em",
              }}>
                Settings
              </span>
              <IconChevronDown
                size={12}
                style={{ transform: showSettingsSub ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}
              />
            </>
          )}
        </button>

        {showSettingsSub && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingLeft: "20px" }}>
            {settingsSubitems.map(({ segment, label }) => {
              const href = `${settingsBase}/${segment}`;
              const isActive = pathname === href || pathname.startsWith(`${href}/`);

              return (
                <Link
                  key={segment}
                  href={href}
                  style={{
                    height: "32px",
                    borderRadius: "var(--radius-md)",
                    display: "flex", alignItems: "center",
                    paddingLeft: "10px", paddingRight: "10px",
                    color: isActive ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                    background: isActive ? "var(--color-accent-subtle)" : "transparent",
                    textDecoration: "none",
                    transition: "background var(--transition-fast), color var(--transition-fast)",
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = "var(--color-accent-subtle)";
                      (e.currentTarget as HTMLElement).style.color = "var(--color-text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "var(--color-text-tertiary)";
                    }
                  }}
                >
                  <span style={{
                    fontFamily: "var(--font-sans)", fontSize: "12px",
                    fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap",
                  }}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );
}
