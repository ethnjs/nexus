"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, Form, formsApi, tournamentOnboardingApi } from "@/lib/api";
import { FormFillFlow } from "@/components/forms/FormFillFlow";
import { Spinner } from "@/components/ui/Spinner";

export default function TournamentOnboardingFormPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const formId = String(params.formId);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : "Failed to load form."));
  }, [formId]);

  async function submitAndAdvance(answers: Record<string, unknown>) {
    await formsApi.submitResponse(
      formId,
      Object.entries(answers).map(([field_id, value]) => ({ field_id, value })),
    );
    const progress = await tournamentOnboardingApi.progress(tournamentId);
    router.replace(
      progress.next_form_id
        ? `/tournaments/${tournamentId}/onboarding/forms/${progress.next_form_id}`
        : `/dashboard/tournaments/${tournamentId}/overview`,
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{loadError}</p>
      </div>
    );
  }

  if (!form) {
    return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
  }

  return (
    <FormFillFlow
      form={form}
      successMessage="Your response was saved."
      onComplete={submitAndAdvance}
    />
  );
}
