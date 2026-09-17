"use client";

import { Topbar } from "@/components/layout/Topbar";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { NavDrawerProvider } from "@/lib/useNavDrawer";
import styles from "@/components/settings/Settings.module.css";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavDrawerProvider>
      <div className={styles.page}>
        <Topbar showWordmark showAvatar showNavToggle />
        <div className={styles.container}>
          <SettingsNav />
          <div className={styles.content}>
            {children}
          </div>
        </div>
      </div>
    </NavDrawerProvider>
  );
}
