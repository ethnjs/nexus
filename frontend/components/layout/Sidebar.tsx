"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChevronDown } from "@/components/ui/Icons";
import { useNavDrawer } from "@/lib/useNavDrawer";
import styles from "./Sidebar.module.css";

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
  /**
   * Rendered under the wordmark, mobile only. For a control the phone-width
   * Topbar has no room for — today, the tournament switcher.
   */
  navHeader?: ReactNode;
}

function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/**
 * The app's nav. Presentational only — it renders whatever items it is handed
 * and knows nothing about tournaments or admin. See TournamentSidebar and
 * AdminSidebar for the two item sets.
 *
 * One markup tree, two arrangements chosen by media query in Sidebar.module.css:
 *  - desktop: a collapsed rail that widens on hover and overlays the page.
 *  - mobile:  an off-canvas drawer behind a scrim, since hover-to-expand has
 *             no touch equivalent and the rail would otherwise be a dead 52px
 *             strip. The button that opens it belongs to the Topbar; this
 *             reads its state from NavDrawerProvider.
 *
 * The viewport switch is CSS, not a useIsMobile() branch, so the first painted
 * frame is already correct — see the note at the top of the stylesheet. The
 * only state here is interaction state (hover, open drawer, open group), which
 * can't exist before hydration anyway.
 */
export function Sidebar({ items, onExpandedChange, homeHref = "/dashboard", navHeader }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const pathname = usePathname();
  // The toggle lives in the Topbar, so the open state is shared through a
  // context rather than held here. See lib/useNavDrawer.tsx.
  const { open: drawerOpen, setOpen: setDrawerOpen } = useNavDrawer();

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

  useEffect(() => {
    // Drives the desktop Topbar's padding for the overlaying rail. Hover can't
    // happen before hydration and the mobile drawer overlays nothing the
    // Topbar must compensate for, so this staying false on a phone is correct.
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <>
      <div
        onClick={() => setDrawerOpen(false)}
        className={cx(styles.scrim, drawerOpen && styles.open)}
      />

      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cx(
          styles.aside,
          activeGroup !== null && styles.locked,
          drawerOpen && styles.open,
        )}
      >
        <div className={styles.header}>
          <Link href={homeHref} style={{ textDecoration: "none" }}>
            <span className={cx(styles.wordmark, styles.wordmarkFull)}>NEXUS</span>
            <span className={cx(styles.wordmark, styles.wordmarkShort)}>NX</span>
          </Link>
        </div>

        {navHeader && <div className={styles.navHeader}>{navHeader}</div>}

        <nav className={styles.nav}>
          {items.map((item) => {
            const active = isActive(item);
            const isGroup = !!item.subitems;
            // Open on its own route, or when clicked. Unlike before, this no
            // longer gates on `expanded`: the subitems are hidden by the same
            // CSS that hides the labels when the rail is narrow.
            const showSub = isGroup && (active || openGroup === item.key);

            return (
              <div key={item.key} style={{ display: "contents" }}>
                {isGroup ? (
                  <button
                    type="button"
                    onClick={() => setOpenGroup((k) => (k === item.key ? null : item.key))}
                    title={item.label}
                    className={cx(styles.row, active && styles.active)}
                  >
                    {active && <div className={styles.activeBar} />}
                    {item.icon}
                    <span className={styles.label}>{item.label}</span>
                    <IconChevronDown
                      size={12}
                      className={cx(styles.chevron, showSub && styles.chevronOpen)}
                    />
                  </button>
                ) : (
                  <Link
                    href={item.href!}
                    title={item.label}
                    onClick={() => setDrawerOpen(false)}
                    className={cx(styles.row, active && styles.active)}
                  >
                    {active && <div className={styles.activeBar} />}
                    {item.icon}
                    <span className={styles.label}>{item.label}</span>
                  </Link>
                )}

                {showSub && (
                  <div className={styles.subRows}>
                    {item.subitems!.map(({ href, label }) => {
                      const subActive = pathname === href || pathname.startsWith(`${href}/`);
                      return (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setDrawerOpen(false)}
                          className={cx(styles.subRow, subActive && styles.active)}
                        >
                          <span className={styles.subLabel}>{label}</span>
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
    </>
  );
}
