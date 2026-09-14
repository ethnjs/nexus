"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Topbar } from "@/components/layout/Topbar";
import { LayoutPanelProvider } from "@/lib/useLayoutPanel";
import { LayoutPanelSlot } from "@/components/layout/LayoutPanelSlot";
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

  if (pathname.startsWith("/dashboard/tournaments/")) {
    return <>{children}</>;
  }

  return (
    <LayoutPanelProvider>
      <div className={styles.shell}>
        <AdminSidebar onExpandedChange={setSidebarExpanded} />
        <div className={styles.column}>
          {/* The rail carries the wordmark on desktop, but it's an off-canvas
              drawer on mobile — so the bar takes over there. */}
          <Topbar
            showWordmark="mobile-only"
            showAvatar
            sidebarExpanded={sidebarExpanded}
            clearsMobileToggle
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
  );
}
