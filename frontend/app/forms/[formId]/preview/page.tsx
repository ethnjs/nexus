"use client";

import { notFound } from "next/navigation";
import { use, useEffect, useState } from "react";
import { FormFillFlow } from "@/components/forms/FormFillFlow";
import { NoFormAccess } from "@/components/forms/NoFormAccess";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { type Form, formsApi } from "@/lib/api";
import { builderLoadFailure } from "@/lib/forms/builderLoad";

// Must work on draft forms. Without onComplete, Submit only validates and nothing is saved.
export default function FormPreviewPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [missing, setMissing] = useState(false);
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    // listArchivedFields only gates the page to managers (the smallest manage-access read);
    // the preview renders get's respondent shape.
    Promise.allSettled([formsApi.get(formId), formsApi.listArchivedFields(formId)]).then(
      ([loaded, gate]) => {
        if (loaded.status === "fulfilled" && gate.status === "fulfilled") {
          setForm(loaded.value);
          return;
        }
        const reasons = [loaded, gate].flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
        const failure = builderLoadFailure(reasons, "Failed to load form.");
        if (failure === "no-access") setNoAccess(true);
        else if (failure === "not-found") setMissing(true);
        else setLoadError(failure.message);
      },
    );
  }, [formId]);

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

  function startOver() {
    setRunCount((n) => n + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <FormFillFlow
      key={runCount}
      form={form}
      banner={<Banner variant="info" message="Preview mode — nothing submitted here is saved." />}
      successMessage="This preview is complete — no response was recorded."
      successAction={
        <Button type="button" variant="secondary" size="sm" onClick={startOver}>
          Start over
        </Button>
      }
    />
  );
}
