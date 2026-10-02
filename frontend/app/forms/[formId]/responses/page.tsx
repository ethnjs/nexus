"use client";

import { CSSProperties, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formsApi, Form, FormField, FormResponseManager, ApiError } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { ARCHIVED_REASON } from "@/lib/useArchiveLock";
import { Spinner } from "@/components/ui/Spinner";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { SubHeader, FORM_TABS_HEIGHT } from "@/components/forms/SubHeader";
import { ResponsesView, respondentName } from "@/components/forms/ResponsesView";

// Two panes need more room than the builder's 800px column.
const RESPONSES_MAX_WIDTH = 1100;

const FORM_ARCHIVED_REASON = "This form is archived — unarchive it to delete responses.";

export default function FormResponsesPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);
  const router = useRouter();
  const run = useActionToast();

  const [form, setForm] = useState<Form | null>(null);
  // Kept apart from `form`: the header's edits come back unhydrated
  // (formsApi.update), and the answers need hydrated options to render.
  const [fields, setFields] = useState<FormField[]>([]);
  const [responses, setResponses] = useState<FormResponseManager[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FormResponseManager | null>(null);

  useEffect(() => {
    Promise.all([formsApi.get(formId), formsApi.listResponses(formId)])
      .then(([loaded, list]) => {
        setForm(loaded);
        setFields(loaded.fields.filter((f) => !f.is_archived));
        setResponses(list);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load responses."));
  }, [formId]);

  function handleDeleted() {
    if (form?.owner_type === "tournament") {
      router.push(`/dashboard/tournaments/${form.tournament_id}/forms`);
    } else {
      router.back();
    }
  }

  function removeResponse(id: string) {
    setResponses((prev) => (prev ?? []).filter((r) => r.id !== id));
    setForm((prev) => (prev ? { ...prev, response_count: Math.max(0, prev.response_count - 1) } : prev));
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

  if (!form || responses === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const tournamentArchived = !!form.tournament_is_archived;
  const deleteLockedReason = tournamentArchived
    ? ARCHIVED_REASON
    : form.status === "archived" ? FORM_ARCHIVED_REASON : undefined;

  return (
    <div>
      <SubHeader
        form={form} onUpdated={setForm} onDeleted={handleDeleted} locked={tournamentArchived}
        activeTab="responses" maxWidth={RESPONSES_MAX_WIDTH} stickyTabs
      />
      <div style={{
        maxWidth: `${RESPONSES_MAX_WIDTH}px`, margin: "0 auto", padding: "0 24px 22px",
        // The respondent list pins itself just under the sticky tab row.
        "--list-top": `${TOPBAR_HEIGHT + FORM_TABS_HEIGHT}px`,
      } as CSSProperties}>
        <ResponsesView
          fields={fields}
          responses={responses}
          deleteLockedReason={deleteLockedReason}
          onDelete={setPendingDelete}
        />
      </div>

      {pendingDelete && (
        <BulkDeleteModal
          items={[pendingDelete]}
          noun="response"
          description={
            <>
              Delete <strong>{respondentName(pendingDelete.respondent)}</strong>&rsquo;s response? Their
              answers are removed; roster data like availability stays. If this is an onboarding
              form, they&rsquo;ll need to complete it again.
            </>
          }
          onDelete={(r) => run(
            `${respondentName(r.respondent)}'s response deleted`,
            () => formsApi.deleteResponse(formId, r.id),
          )}
          onClose={() => setPendingDelete(null)}
          onDeleted={(ids) => ids.forEach((id) => removeResponse(String(id)))}
        />
      )}
    </div>
  );
}
