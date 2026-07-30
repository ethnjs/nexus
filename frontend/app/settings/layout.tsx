"use client";

import { Topbar } from "@/components/layout/Topbar";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { useIsMobile } from "@/lib/useIsMobile";
import { SETTINGS_NAV_WIDTH, SETTINGS_CONTAINER_MAX_WIDTH } from "@/app/settings/constants";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar extraLeftPad={isMobile ? 44 : 0} />
      <div style={{ maxWidth: `${SETTINGS_CONTAINER_MAX_WIDTH}px`, margin: "0 auto" }}>
        <SettingsNav />
        <div style={{
          marginLeft: isMobile ? 0 : `${SETTINGS_NAV_WIDTH}px`,
          maxWidth: "700px",
          padding: isMobile ? "64px 20px 40px" : "16px 20px 40px",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}
