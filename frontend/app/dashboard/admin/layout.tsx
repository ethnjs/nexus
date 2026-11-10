"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { LoadingState } from "@/components/ui/LoadingState";
import { useAuth } from "@/lib/useAuth";

/**
 * Gate for every /dashboard/admin page.
 *
 * Client-side only, and deliberately so: it exists to keep a non-admin from
 * staring at an empty table, not to protect anything. Every route behind
 * these pages is admin-gated server-side, so a reader who defeats this sees
 * 403s rather than data.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const allowed = user?.role === "admin";

  useEffect(() => {
    if (!loading && !allowed) router.replace("/dashboard");
  }, [loading, allowed, router]);

  if (loading) {
    return <LoadingState />;
  }

  // Render nothing through the redirect rather than flashing the page.
  if (!allowed) return null;

  return <>{children}</>;
}
