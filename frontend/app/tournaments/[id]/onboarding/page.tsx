"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, tournamentOnboardingApi } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

// Resolves the member's stored onboarding state into the next form. This is
// intentionally separate from /join so returning members can resume the
// exact same flow without a join code.
export default function TournamentOnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tournamentOnboardingApi.progress(tournamentId)
      .then((progress) => {
        if (progress.next_form_id) {
          router.replace(`/tournaments/${tournamentId}/onboarding/forms/${progress.next_form_id}`);
        } else {
          router.replace(`/dashboard/tournaments/${tournamentId}/overview`);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tournament onboarding."));
  }, [router, tournamentId]);

  if (error) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
      </div>
    );
  }

  return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
}
