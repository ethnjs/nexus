"use client";

import { useCallback, useEffect, useState } from "react";
import { FormView } from "@/components/tournament/forms/flow/FormView";
import { OnboardingView } from "@/components/tournament/forms/flow/OnboardingView";
import { MemberFlowView, PreviewMemberList } from "@/components/tournament/forms/flow/PreviewView";
import type { RoleOption } from "@/components/tournament/forms/PrerequisiteEditor";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { IconEye, IconX } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { NavHeading, NavItem } from "@/components/ui/ModalNav";
import { type FormListItem, type PersonRef, rolesApi } from "@/lib/api";

export type FormFlowView =
  | { kind: "onboarding" }
  | { kind: "form"; formId: string }
  | { kind: "preview" };

/** Who sees which form, and in what order: the onboarding sequence and each
 *  form's prerequisites and settings, one view at a time. */
export function FormFlowModal({
  tournamentId,
  forms,
  initialView = { kind: "onboarding" },
  lockedReason,
  onClose,
  onChanged,
}: {
  tournamentId: number;
  forms: FormListItem[];
  initialView?: FormFlowView;
  /** Archived tournament — everything is readable, nothing saves. */
  lockedReason?: string;
  onClose: () => void;
  /** Something saved; the forms list should reload. */
  onChanged: () => void;
}) {
  const [view, setView] = useState<FormFlowView>(initialView);
  const [dirty, setDirty] = useState(false);
  // What to do once the TD agrees to drop unsaved changes.
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  // Where Back from the preview returns to, and who's being previewed.
  const [beforePreview, setBeforePreview] = useState<FormFlowView>(initialView);
  const [previewMember, setPreviewMember] = useState<PersonRef | null>(null);

  useEffect(() => {
    rolesApi
      .list(tournamentId)
      .then((list) => setRoles(list.map((r) => ({ id: r.id, label: r.label }))))
      .catch(() => {});
  }, [tournamentId]);

  const roleLabel = (id: number) => roles.find((r) => r.id === id)?.label ?? "a deleted role";
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);

  function guard(next: () => void) {
    if (dirty) setPending(() => next);
    else next();
  }

  function open(next: FormFlowView) {
    guard(() => {
      setDirty(false);
      setView(next);
    });
  }

  function startPreview() {
    guard(() => {
      setDirty(false);
      setBeforePreview(view);
      setView({ kind: "preview" });
    });
  }

  const previewing = view.kind === "preview";
  const current = view.kind === "form" ? forms.find((f) => f.id === view.formId) : undefined;

  return (
    <Modal
      onClose={() => guard(onClose)}
      closeOnOverlayClick={false}
      width={960}
      contentStyle={{
        padding: 0,
        height: "min(680px, calc(100vh - 32px))",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: "20px",
            fontWeight: 400,
            color: "var(--color-text-primary)",
          }}
        >
          Form flow
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          title="Close"
          onClick={() => guard(onClose)}
        >
          <IconX size={14} />
        </Button>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Two panes in a clipped window, like Export: Preview slides the
          track one pane-width left to swap the forms list for the members. */}
        <aside
          style={{
            width: "240px",
            flexShrink: 0,
            overflow: "hidden",
            borderRight: "1px solid var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <div
            className="slide-panel-track"
            style={{
              display: "flex",
              width: "200%",
              height: "100%",
              // Margin, not transform: a transform would trap popovers'
              // position: fixed menus inside this clipped strip.
              marginLeft: previewing ? "-100%" : 0,
            }}
          >
            {/* inert: the off-screen pane must not take Tab focus. */}
            <nav
              inert={previewing}
              style={{ width: "50%", display: "flex", flexDirection: "column" }}
            >
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "8px",
                }}
              >
                <NavItem
                  active={view.kind === "onboarding"}
                  onClick={() => open({ kind: "onboarding" })}
                >
                  Onboarding
                </NavItem>
                <NavHeading>Forms</NavHeading>
                {forms.map((form) => (
                  <NavItem
                    key={form.id}
                    active={view.kind === "form" && view.formId === form.id}
                    onClick={() => open({ kind: "form", formId: form.id })}
                  >
                    {form.name}
                  </NavItem>
                ))}
              </div>
              <div style={{ padding: "8px", borderTop: "1px solid var(--color-border)" }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={startPreview}
                >
                  <IconEye size={13} /> Preview
                </Button>
              </div>
            </nav>
            <section
              inert={!previewing}
              style={{ width: "50%", display: "flex", flexDirection: "column" }}
            >
              <PreviewMemberList
                tournamentId={tournamentId}
                selectedId={previewMember?.membership_id ?? null}
                onSelect={setPreviewMember}
                onBack={() => setView(beforePreview)}
              />
            </section>
          </div>
        </aside>

        {view.kind === "preview" ? (
          <MemberFlowView
            key={previewMember?.membership_id ?? "none"}
            tournamentId={tournamentId}
            member={previewMember}
          />
        ) : view.kind === "onboarding" ? (
          <OnboardingView
            tournamentId={tournamentId}
            forms={forms}
            roleLabel={roleLabel}
            lockedReason={lockedReason}
            onDirtyChange={onDirtyChange}
            onSaved={onChanged}
          />
        ) : current ? (
          <FormView
            key={current.id}
            tournamentId={tournamentId}
            form={current}
            roles={roles}
            lockedReason={lockedReason}
            onDirtyChange={onDirtyChange}
            onChanged={onChanged}
          />
        ) : null}
      </div>

      {pending && (
        <ConfirmModal
          title="Discard changes?"
          description="You have unsaved changes in this view. They'll be lost."
          confirmLabel="Discard"
          onConfirm={async () => pending()}
          onClose={() => setPending(null)}
        />
      )}
    </Modal>
  );
}
