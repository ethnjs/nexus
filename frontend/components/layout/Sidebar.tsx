"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChevronDown } from "@/components/ui/Icons";

export const COLLAPSED_W = 52;
export const EXPANDED_W  = 192;

export interface SidebarSubitem {
  href:  string;
  label: string;
}

export interface SidebarItem {
  /** Stable identity for the row — the href isn't one for a group, which has none. */
  key:   string;
  icon:  ReactNode;
  label: string;
  /** Where the row navigates. Omitted on a group, which only opens its subitems. */
  href?: string;
  /**
   * Route prefix that marks this row active. Defaults to `href`; a group needs
   * it explicitly, since it has no href to derive it from.
   */
  match?: string;
  /**
   * Match the route exactly instead of as a prefix. Needed by any row whose
   * href is an ancestor of its siblings' — "/dashboard" would otherwise read
   * as active on every "/dashboard/..." page.
   */
  exact?: boolean;
  subitems?: SidebarSubitem[];
}

interface SidebarProps {
  items: SidebarItem[];
  onExpandedChange?: (expanded: boolean) => void;
  /** Href for the wordmark. */
  homeHref?: string;
}

const ROW_BASE = {
  height: "38px",
  borderRadius: "var(--radius-md)",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  paddingLeft: "10px",
  paddingRight: "10px",
  justifyContent: "flex-start",
  width: "100%",
  position: "relative",
  transition: "background var(--transition-fast), color var(--transition-fast)",
  boxSizing: "border-box",
  textDecoration: "none",
} as const;

/** Hover paints the row only when it isn't already the active one. */
function hoverHandlers(isActive: boolean) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (isActive) return;
      e.currentTarget.style.background = "var(--color-accent-subtle)";
      e.currentTarget.style.color = "var(--color-text-primary)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      if (isActive) return;
      e.currentTarget.style.background = "transparent";
      e.currentTarget.style.color = "var(--color-text-tertiary)";
    },
  };
}

function ActiveBar() {
  return (
    <div style={{
      position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
      width: "3px", height: "20px",
      background: "var(--color-accent)", borderRadius: "0 3px 3px 0",
    }} />
  );
}

/**
 * The app's collapsed-to-hover nav rail. Presentational only — it renders
 * whatever items it is handed and knows nothing about tournaments or admin.
 * See TournamentSidebar and AdminSidebar for the two item sets.
 */
export function Sidebar({ items, onExpandedChange, homeHref = "/dashboard" }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const pathname = usePathname();

  function isActive(item: SidebarItem): boolean {
    const prefix = item.match ?? item.href;
    if (!prefix) return false;
    if (item.exact) return pathname === prefix;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }

  // A group's own route locks the rail open rather than leaving its sub-nav
  // labels readable only while the mouse stays parked on the rail.
  const activeGroup = items.find((i) => i.subitems && isActive(i)) ?? null;
  const expanded = hovered || activeGroup !== null;
  const width = expanded ? EXPANDED_W : COLLAPSED_W;

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        <Link href={homeHref} style={{ textDecoration: "none" }}>
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
        {items.map((item) => {
          const active = isActive(item);
          const isGroup = !!item.subitems;
          // Open on its own route, or when clicked — but only while the rail
          // is wide enough for the labels to mean anything.
          const showSub = isGroup && expanded && (active || openGroup === item.key);

          const rowStyle = {
            ...ROW_BASE,
            color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            background: active ? "var(--color-accent-subtle)" : "transparent",
          };
          const labelStyle = {
            fontFamily: "var(--font-sans)", fontSize: "13px",
            fontWeight: active ? 600 : 400, whiteSpace: "nowrap", letterSpacing: "0.01em",
          } as const;

          return (
            <div key={item.key} style={{ display: "contents" }}>
              {isGroup ? (
                <button
                  type="button"
                  onClick={() => setOpenGroup((k) => (k === item.key ? null : item.key))}
                  title={expanded ? undefined : item.label}
                  style={{ ...rowStyle, border: "none", font: "inherit", cursor: "pointer" }}
                  {...hoverHandlers(active)}
                >
                  {active && <ActiveBar />}
                  {item.icon}
                  {expanded && (
                    <>
                      <span style={{ ...labelStyle, flex: 1, textAlign: "left" }}>{item.label}</span>
                      <IconChevronDown
                        size={12}
                        style={{ transform: showSub ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}
                      />
                    </>
                  )}
                </button>
              ) : (
                <Link
                  href={item.href!}
                  title={expanded ? undefined : item.label}
                  style={rowStyle}
                  {...hoverHandlers(active)}
                >
                  {active && <ActiveBar />}
                  {item.icon}
                  {expanded && <span style={labelStyle}>{item.label}</span>}
                </Link>
              )}

              {showSub && (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingLeft: "20px" }}>
                  {item.subitems!.map(({ href, label }) => {
                    const subActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link
                        key={href}
                        href={href}
                        style={{
                          height: "32px",
                          borderRadius: "var(--radius-md)",
                          display: "flex", alignItems: "center",
                          paddingLeft: "10px", paddingRight: "10px",
                          color: subActive ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                          background: subActive ? "var(--color-accent-subtle)" : "transparent",
                          textDecoration: "none",
                          transition: "background var(--transition-fast), color var(--transition-fast)",
                          boxSizing: "border-box",
                        }}
                        {...hoverHandlers(subActive)}
                      >
                        <span style={{
                          fontFamily: "var(--font-sans)", fontSize: "12px",
                          fontWeight: subActive ? 600 : 400, whiteSpace: "nowrap",
                        }}>
                          {label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
