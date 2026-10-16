"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, tournamentOnboardingApi } from "@/lib/api";
import { safeRedirectPath } from "@/lib/auth";

// Resolves the member's stored onboarding state into the next form. This is
// intentionally separate from /join so returning members can resume the
// exact same flow without a join code. `redirect` (a shared form link the
// sequence interrupted) rides along through every step and is where it ends.
export default function TournamentOnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tournamentId = Number(params.id);
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tournamentOnboardingApi
      .progress(tournamentId)
      .then((progress) => {
        if (progress.next_form_id) {
          const self = redirect
            ? `/tournaments/${tournamentId}/onboarding?redirect=${encodeURIComponent(redirect)}`
            : `/tournaments/${tournamentId}/onboarding`;
          router.replace(
            `/forms/${progress.next_form_id}/view?redirect=${encodeURIComponent(self)}`,
          );
        } else {
          router.replace(redirect ?? `/dashboard/tournaments/${tournamentId}/overview`);
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load tournament onboarding."),
      );
  }, [router, tournamentId, redirect]);

  if (error) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p
          style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
      <Spinner size="lg" />
    </div>
  );
}
