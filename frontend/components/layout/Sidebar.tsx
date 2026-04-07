"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconHome,
  IconAssignments,
  IconEvents,
  IconVolunteers,
  IconSheets,
  IconSettings,
  IconChevronRight,
} from "@/components/ui/Icons";

export const COLLAPSED_W = 52;
export const EXPANDED_W  = 192;

const NAV_ITEMS = [
  { segment: "overview",    icon: <IconHome />,               label: "Overview" },
  { segment: "assignments", icon: <IconAssignments />,        label: "Assignments" },
  { segment: "events",      icon: <IconEvents />,             label: "Events" },
  { segment: "volunteers",  icon: <IconVolunteers />,         label: "Volunteers" },
  { segment: "sheets",      icon: <IconSheets />,             label: "Sheets" },
  { segment: "settings",    icon: <IconSettings size={18} />, label: "Settings" },
];

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
  tournamentId: string | number;
}

export function Sidebar({ expanded, onToggle, tournamentId }: SidebarProps) {
  const pathname = usePathname();
  const width = expanded ? EXPANDED_W : COLLAPSED_W;
  const base = `/dashboard/${tournamentId}`;

  return (
    <aside style={{
      width,
      height: "100vh",
      position: "fixed",
      top: 0,
      left: 0,
      background: "var(--color-surface)",
      borderRight: "1px solid var(--color-border)",
      display: "flex",
      flexDirection: "column",
      alignItems: expanded ? "stretch" : "center",
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
        alignItems: expanded ? "stretch" : "center",
      }}>
        {NAV_ITEMS.map(({ segment, icon, label }) => {
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
                paddingLeft:  expanded ? "10px" : "0",
                paddingRight: expanded ? "10px" : "0",
                justifyContent: expanded ? "flex-start" : "center",
                width: expanded ? "100%" : "38px",
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
      </nav>

      {/* Toggle — pinned to bottom */}
      <div style={{
        padding: "10px 6px",
        borderTop: "1px solid var(--color-border)",
        display: "flex", alignItems: "center",
        justifyContent: expanded ? "flex-end" : "center",
        paddingRight: expanded ? "10px" : "6px",
      }}>
        <button
          onClick={onToggle}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          style={{
            width: "38px", height: "38px",
            borderRadius: "var(--radius-md)",
            border: "none", background: "transparent",
            color: "var(--color-text-tertiary)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background var(--transition-fast), color var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-accent-subtle)";
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--color-text-tertiary)";
          }}
        >
          <IconChevronRight expanded={expanded} />
        </button>
      </div>
    </aside>
  );
}