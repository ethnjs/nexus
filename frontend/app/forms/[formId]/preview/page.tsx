"use client";

import { notFound } from "next/navigation";
import { use, useEffect, useState } from "react";
import { FormFillFlow } from "@/components/forms/FormFillFlow";
import { NoFormAccess } from "@/components/forms/NoFormAccess";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { type Form, formsApi } from "@/lib/api";
import { builderLoadFailure } from "@/lib/forms/builderLoad";

// TD-only, read-only-but-simulated view of the form as a respondent would
// see it — must work on draft forms (that's the point of previewing before
// publishing). FormFillFlow's onComplete is left unset, so Submit only ever
// runs validation; no FormResponse is ever created here.
export default function FormPreviewPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    // getForEdit only gates the page to managers; the preview renders the
    // respondent's hydrated shape from get.
    Promise.allSettled([formsApi.get(formId), formsApi.getForEdit(formId)]).then(
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

  return (
    <FormFillFlow
      form={form}
      banner={<Banner variant="info" message="Preview mode — nothing submitted here is saved." />}
      successMessage="This preview is complete — no response was recorded."
    />
  );
}
