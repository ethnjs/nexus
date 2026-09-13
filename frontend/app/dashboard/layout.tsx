"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { COLLAPSED_W } from "@/components/layout/Sidebar";

/**
 * Shell for the dashboard root and the admin pages under it.
 *
 * Tournament routes are excluded deliberately: they nest under this layout by
 * path but bring their own rail (see TournamentSidebar), and rendering both
 * would stack two fixed-position rails on top of each other. The alternative
 * — a route group to un-nest them — would move every tournament page on disk
 * for no gain, so the exclusion lives here as one condition.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/dashboard/tournaments/")) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-bg)" }}>
      <AdminSidebar />
      {/* Fixed margin, not the live width: the rail overlays on hover rather
          than pushing the page, same as it does on tournament routes. */}
      <div style={{ flex: 1, minWidth: 0, marginLeft: COLLAPSED_W }}>
        {children}
      </div>
    </div>
  );
}
