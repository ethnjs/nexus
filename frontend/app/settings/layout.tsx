import { Topbar } from "@/components/layout/Topbar";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />
      <div style={{ display: "flex", maxWidth: "1000px", margin: "0 auto" }}>
        <SettingsNav />
        <div style={{ flex: 1, minWidth: 0, padding: "32px 20px 0px", maxWidth: "700px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
