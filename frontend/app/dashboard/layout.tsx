"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/lib/useAuth";

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}