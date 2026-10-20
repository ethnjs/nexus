"use client";

import { notFound, useRouter } from "next/navigation";
import { type CSSProperties, use, useEffect, useState } from "react";
import { NoFormAccess } from "@/components/forms/NoFormAccess";
import { ResponsesView, respondentName } from "@/components/forms/ResponsesView";
import { SubHeader } from "@/components/forms/SubHeader";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { Spinner } from "@/components/ui/Spinner";
import { type Form, type FormField, type FormResponseManager, formsApi } from "@/lib/api";
import { builderLoadFailure } from "@/lib/forms/builderLoad";
import { useActionToast } from "@/lib/useActionToast";
import { ARCHIVED_REASON } from "@/lib/useArchiveLock";

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
  const [noAccess, setNoAccess] = useState(false);
  const [missing, setMissing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FormResponseManager | null>(null);

  useEffect(() => {
    // allSettled, not all: which of the two fails first decides nothing.
    Promise.allSettled([formsApi.get(formId), formsApi.listResponses(formId)]).then(
      ([loaded, list]) => {
        if (loaded.status === "fulfilled" && list.status === "fulfilled") {
          setForm(loaded.value);
          setFields(loaded.value.fields);
          setResponses(list.value);
          return;
        }
        const reasons = [loaded, list].flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
        const failure = builderLoadFailure(reasons, "Failed to load responses.");
        if (failure === "no-access") setNoAccess(true);
        else if (failure === "not-found") setMissing(true);
        else setLoadError(failure.message);
      },
    );
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
    setForm((prev) =>
      prev ? { ...prev, response_count: Math.max(0, prev.response_count - 1) } : prev,
    );
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
    : form.status === "archived"
      ? FORM_ARCHIVED_REASON
      : undefined;

  return (
    <div>
      <SubHeader
        form={form}
        onUpdated={setForm}
        onDeleted={handleDeleted}
        locked={tournamentArchived}
        activeTab="responses"
        maxWidth={RESPONSES_MAX_WIDTH}
      />
      <div
        style={
          {
            maxWidth: `${RESPONSES_MAX_WIDTH}px`,
            margin: "0 auto",
            padding: "0 24px 22px",
            "--list-top": `${TOPBAR_HEIGHT + 16}px`,
          } as CSSProperties
        }
      >
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
              Delete <strong>{respondentName(pendingDelete.respondent)}</strong>&rsquo;s response?
              Their answers are removed; roster data like availability stays. If this is an
              onboarding form, they&rsquo;ll need to complete it again.
            </>
          }
          onDelete={(r) =>
            run(`${respondentName(r.respondent)}'s response deleted`, () =>
              formsApi.deleteResponse(formId, r.id),
            )
          }
          onClose={() => setPendingDelete(null)}
          onDeleted={(ids) =>
            ids.forEach((id) => {
              removeResponse(String(id));
            })
          }
        />
      )}
    </div>
  );
}
