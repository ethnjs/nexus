"use client";

import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { FieldList } from "@/components/forms/FieldList";
import { NoFormAccess } from "@/components/forms/NoFormAccess";
import { CONTENT_MAX_WIDTH, SubHeader } from "@/components/forms/SubHeader";
import { TitleCard } from "@/components/forms/TitleCard";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { type Form, formsApi } from "@/lib/api";
import { builderLoadFailure } from "@/lib/forms/builderLoad";
import { ARCHIVED_REASON } from "@/lib/useArchiveLock";

export default function FormEditPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);
  const router = useRouter();

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    formsApi
      .getForEdit(formId)
      .then(setForm)
      .catch((e) => {
        const failure = builderLoadFailure([e], "Failed to load form.");
        if (failure === "no-access") setNoAccess(true);
        else if (failure === "not-found") setMissing(true);
        else setLoadError(failure.message);
      });
  }, [formId]);

  function handleDeleted() {
    if (form?.owner_type === "tournament") {
      router.push(`/dashboard/tournaments/${form.tournament_id}/forms`);
    } else {
      router.back();
    }
  }

  if (missing) notFound();
  if (noAccess) return <NoFormAccess />;

  if (loadError) {
    return (
      <div style={{ padding: "22px 24px" }}>
        <p
          style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}
        >
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
      <SubHeader
        form={form}
        onUpdated={setForm}
        onDeleted={handleDeleted}
        locked={locked}
        activeTab="questions"
      />
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
