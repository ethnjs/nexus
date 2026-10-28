"use client";

import { useCallback, useEffect, useState } from "react";
import { FormView } from "@/components/tournament/forms/flow/FormView";
import { OnboardingView } from "@/components/tournament/forms/flow/OnboardingView";
import type { RoleOption } from "@/components/tournament/forms/PrerequisiteEditor";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { IconX } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { NavHeading, NavItem } from "@/components/ui/ModalNav";
import { type FormListItem, rolesApi } from "@/lib/api";

export type FormFlowView = { kind: "onboarding" } | { kind: "form"; formId: string };

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
        <aside
          style={{
            width: "240px",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            padding: "8px",
            overflowY: "auto",
            borderRight: "1px solid var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <NavItem active={view.kind === "onboarding"} onClick={() => open({ kind: "onboarding" })}>
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
        </aside>

        {view.kind === "onboarding" ? (
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
