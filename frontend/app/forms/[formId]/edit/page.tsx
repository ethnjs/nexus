"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formsApi, Form, ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { Banner } from "@/components/ui/Banner";
import { ARCHIVED_REASON } from "@/lib/useArchiveLock";
import { SubHeader, CONTENT_MAX_WIDTH } from "@/components/forms/SubHeader";
import { TitleCard } from "@/components/forms/TitleCard";
import { FieldList } from "@/components/forms/FieldList";

export default function FormEditPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);
  const router = useRouter();

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    formsApi.getForEdit(formId)
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load form."));
  }, [formId]);

  function handleDeleted() {
    if (form?.owner_type === "tournament") {
      router.push(`/dashboard/tournaments/${form.tournament_id}/forms`);
    } else {
      router.back();
    }
  }

  if (loadError) {
    return (
      <div style={{ padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  // This page lives outside the tournament layout, so the archive flag rides
  // on the form itself rather than coming from useTournament.
  const locked = !!form.tournament_is_archived;

  return (
    <div>
      <SubHeader form={form} onUpdated={setForm} onDeleted={handleDeleted} locked={locked} />
      <div style={{ maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "22px 24px" }}>
        {locked && (
          <div style={{ marginBottom: "16px" }}>
            <Banner variant="warning" message={ARCHIVED_REASON} />
          </div>
        )}
        <TitleCard form={form} onUpdated={setForm} locked={locked} />
        <FieldList form={form} locked={locked} />
      </div>
    </div>
  );
}
