"use client";

import { useState } from "react";
import { formsApi, Form, ApiError } from "@/lib/api";
import { SplitButton, SplitButtonOption } from "@/components/ui/SplitButton";
import { FormActionIcon } from "@/components/forms/FormActionIcon";
import { FormActionOption, formStatusActions } from "@/lib/forms/formStatusActions";

export function StatusControl({ form, onUpdated, onDeleted }: {
  form: Form;
  onUpdated: (form: Form) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The rules for which moves exist live in formStatusActions, shared with
  // the forms table; this only runs them.
  const [primary, ...rest] = formStatusActions(form);

  async function run(option: FormActionOption) {
    setError(undefined);
    if (option.action === "delete") {
      try {
        await formsApi.delete(form.id);
        onDeleted();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to delete form.");
      }
      return;
    }
    setBusy(true);
    try {
      onUpdated(await formsApi.update(form.id, { status: option.target }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${option.label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  const options: SplitButtonOption[] = rest.map((option) => ({
    label: option.label,
    subtitle: option.subtitle,
    icon: <FormActionIcon action={option.action} />,
    danger: option.danger,
    disabled: !!option.disabledReason,
    disabledReason: option.disabledReason,
    action: () => run(option),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
      <SplitButton
        label={primary.label}
        variant="primary"
        size="md"
        loading={busy}
        primaryDisabled={false}
        onClick={() => run(primary)}
        options={options}
      />
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
