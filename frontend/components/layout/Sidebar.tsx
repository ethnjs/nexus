"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const COLLAPSED_W = 52;
export const EXPANDED_W  = 192;

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 18v-6h6v6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconAssign() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2" y="3" width="16" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="9" width="10" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="15" width="12" height="2" rx="1" fill="currentColor" />
      <circle cx="16" cy="14" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14.5 14l1 1 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEvents() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v4M13 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 9h14" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="12" width="3" height="2" rx="0.5" fill="currentColor" />
      <rect x="11" y="12" width="3" height="2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function IconVolunteers() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 17c0-2.21-1.343-4-3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ flexShrink: 0, transition: "transform 0.2s ease", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS = [
  { segment: "overview",    icon: <IconHome />,       label: "Overview" },
  { segment: "assignments", icon: <IconAssign />,     label: "Assignments" },
  { segment: "events",      icon: <IconEvents />,     label: "Events" },
  { segment: "volunteers",  icon: <IconVolunteers />, label: "Volunteers" },
  { segment: "settings",    icon: <GearIcon />,       label: "Settings" },
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
      flexShrink: 0,
      height: "100vh",
      position: "sticky",
      top: 0,
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
          <IconChevron expanded={expanded} />
        </button>
      </div>
    </aside>
  );
}