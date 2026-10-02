"use client";

import { useRouter } from "next/navigation";
import { formsApi, Form, FormStatus } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EditableText } from "@/components/ui/EditableText";
import { IconArrowLeft, IconEye } from "@/components/ui/Icons";
import { StatusControl } from "@/components/forms/StatusControl";
import { FormActionsMenu } from "@/components/forms/FormActionsMenu";
import { TabStrip } from "@/components/ui/TabStrip";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { ARCHIVED_REASON } from "@/lib/useArchiveLock";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

// Matches the centered content column (title card, field list) below it —
// the sub-header's content is constrained the same way, Google-Forms-style,
// rather than stretching edge to edge.
export const CONTENT_MAX_WIDTH = 800;

export type FormTab = "questions" | "responses";

/** The sticky tab row's fixed height, so content pinned below it can offset by it. */
export const FORM_TABS_HEIGHT = 64;

const STATUS_BADGE_VARIANT: Record<FormStatus, "default" | "confirmed" | "removed"> = {
  draft: "default",
  published: "confirmed",
  archived: "removed",
};

export function SubHeader({
  form, onUpdated, onDeleted, locked = false, activeTab, maxWidth = CONTENT_MAX_WIDTH, stickyTabs = false,
}: {
  form: Form;
  onUpdated: (form: Form) => void;
  onDeleted: () => void;
  /** Archived tournament — name and status are frozen. */
  locked?: boolean;
  activeTab: FormTab;
  /** The responses view is two-pane, so it runs wider than the builder. */
  maxWidth?: number;
  /** Pins the tab row under the topbar. Off in the builder, whose field
   *  toolbar already pins itself there. */
  stickyTabs?: boolean;
}) {
  const router = useRouter();
  // Leaving the builder mid-edit must still prompt — the tabs are separate routes.
  const { guard } = useUnsavedChanges();
  const backHref = form.owner_type === "tournament" ? `/dashboard/tournaments/${form.tournament_id}/forms` : null;

  // Two siblings, not one wrapper: sticky only holds within its parent, so
  // the tab row has to sit directly in the page to stay pinned while it scrolls.
  return (
    <>
    <div style={{ maxWidth: `${maxWidth}px`, margin: "0 auto", padding: "16px 24px 0" }}>
      <Card radius="lg" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
        padding: "12px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
          <Button
            type="button" variant="ghost" size="sm" iconOnly
            title="Back to forms"
            onClick={() => (backHref ? router.push(backHref) : router.back())}
          >
            <IconArrowLeft size={14} />
          </Button>
          <EditableText
            value={form.name}
            onSave={async (name) => onUpdated(await formsApi.update(form.id, { name }))}
            textStyle={{ fontSize: "15px", fontWeight: 600 }}
            title={locked ? ARCHIVED_REASON : "Click to edit name"}
            locked={locked}
          />
          <Badge variant={STATUS_BADGE_VARIANT[form.status]}>{form.status}</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button type="button" variant="secondary" size="md" onClick={() => window.open(`/forms/${form.id}/preview`, "_blank")}>
            <IconEye size={14} /> Preview
          </Button>
          <StatusControl
            form={form} onUpdated={onUpdated} onDeleted={onDeleted}
            lockedReason={locked ? ARCHIVED_REASON : undefined}
          />
          <FormActionsMenu formId={form.id} />
        </div>
      </Card>
    </div>
    <div style={{
      // flow-root keeps TabStrip's bottom margin inside this box's background.
      display: "flow-root", height: `${FORM_TABS_HEIGHT}px`, boxSizing: "border-box", paddingTop: "8px",
      background: "var(--color-bg)",
      ...(stickyTabs ? { position: "sticky" as const, top: `${TOPBAR_HEIGHT}px`, zIndex: 5 } : null),
    }}>
      <div style={{ maxWidth: `${maxWidth}px`, margin: "0 auto", padding: "0 24px" }}>
        <TabStrip<FormTab>
          tabs={[
            { key: "questions", label: "Questions" },
            { key: "responses", label: `Responses (${form.response_count})` },
          ]}
          activeKey={activeTab}
          onChange={(tab) => {
            if (tab !== activeTab) guard(() => router.push(`/forms/${form.id}/${tab === "questions" ? "edit" : "responses"}`));
          }}
        />
      </div>
    </div>
    </>
  );
}
