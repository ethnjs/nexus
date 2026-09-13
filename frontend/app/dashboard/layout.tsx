"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { COLLAPSED_W } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { LayoutPanelProvider } from "@/lib/useLayoutPanel";
import { LayoutPanelSlot } from "@/components/layout/LayoutPanelSlot";

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
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--color-bg)" }}>
        <AdminSidebar onExpandedChange={setSidebarExpanded} />
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
          marginLeft: COLLAPSED_W,
        }}>
          {/* No wordmark — the rail carries it. */}
          <Topbar showAvatar sidebarExpanded={sidebarExpanded} />
          <main style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }}>
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
