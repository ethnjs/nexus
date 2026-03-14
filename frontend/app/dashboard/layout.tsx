"use client";

import { useState, ReactNode } from "react";
import { AuthProvider } from "@/lib/useAuth";
import { TournamentProvider } from "@/lib/useTournament";
import { Sidebar, COLLAPSED_W, EXPANDED_W } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const sidebarWidth = sidebarExpanded ? EXPANDED_W : COLLAPSED_W;

  return (
    <AuthProvider>
      <TournamentProvider>
        <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-bg)" }}>
          <Sidebar
            expanded={sidebarExpanded}
            onToggle={() => setSidebarExpanded((v) => !v)}
          />
          <div
            style={{
              flex: 1,
              marginLeft: sidebarWidth,
              display: "flex",
              flexDirection: "column",
              transition: "margin-left 0.2s ease",
            }}
          >
            <Topbar sidebarWidth={sidebarWidth} />
            <main style={{ flex: 1, marginTop: "52px", padding: "28px", overflowY: "auto" }}>
              {children}
            </main>
          </div>
        </div>
      </TournamentProvider>
    </AuthProvider>
  );
}