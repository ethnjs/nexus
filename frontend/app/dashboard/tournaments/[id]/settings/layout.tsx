"use client";

import { usePathname } from "next/navigation";

export default function TournamentSettingsLayout({ children }: { children: React.ReactNode }) {
  const wide = usePathname().endsWith("/settings/invites");
  return <div style={{ maxWidth: wide ? "1200px" : "900px", margin: "0 auto" }}>{children}</div>;
}
