"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Topbar } from "@/components/layout/Topbar";
import { LayoutPanelProvider } from "@/lib/useLayoutPanel";
import { LayoutPanelSlot } from "@/components/layout/LayoutPanelSlot";
import { useAuth } from "@/lib/useAuth";
import { NavDrawerProvider } from "@/lib/useNavDrawer";
import styles from "@/components/layout/Shell.module.css";

/**
 * Shell for the dashboard root and the admin pages under it. Same structure
 * as the tournament shell (see tournaments/[id]/layout.tsx): a fixed rail, a
 * column holding the Topbar and a scrolling <main>, and the rail's collapsed
 * width reserved as a margin so hovering it overlays rather than reflows.
 *
 * Tournament routes are excluded deliberately: they nest under this layout by
 * path but bring their own rail and Topbar, and rendering both would stack two
 * fixed rails. The alternative — a route group to un-nest them — would move
 * every tournament page on disk for no gain, so the exclusion lives here as
 * one condition.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { user } = useAuth();

  // AdminSidebar's only non-admin entry is Home, which on /dashboard is the
  // page you're already on — so for a regular volunteer the rail is a strip
  // (or a drawer) holding one dead link. Drop it entirely and let the Topbar
  // wordmark be the way back. Admins still get the platform areas.
  //
  // `user` is null until useAuth's fetch lands, so this starts false and an
  // admin sees the rail appear a beat late. That's the right way round: the
  // common case renders correctly straight away.
  const showRail = user?.role === "admin";

  if (pathname.startsWith("/dashboard/tournaments/")) {
    return <>{children}</>;
  }

  return (
    // Above the shell so the Topbar's drawer toggle and the rail it opens
    // share one state — they're siblings inside it.
    <NavDrawerProvider>
      <LayoutPanelProvider>
        <div className={styles.shell}>
          {showRail && <AdminSidebar onExpandedChange={setSidebarExpanded} />}
          <div className={showRail ? styles.column : `${styles.column} ${styles.columnBare}`}>
            {/* With a rail, it carries the wordmark on desktop and the bar only
                takes over on mobile, where the rail is an off-canvas drawer.
                With no rail, the bar is the only thing carrying it. */}
            <Topbar
              showWordmark={showRail ? "mobile-only" : true}
              showAvatar
              sidebarExpanded={sidebarExpanded}
              showNavToggle={showRail}
            />
            <main className={styles.main}>
              {children}
            </main>
          </div>
          {/* Third flex sibling, not an overlay: it shrinks the column above
              instead of covering it, so the table stays live beside it. */}
          <LayoutPanelSlot />
        </div>
      </LayoutPanelProvider>
    </NavDrawerProvider>
  );
}
