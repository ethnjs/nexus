import { FormStatus } from "@/lib/api";

export type FormStatusAction = "publish" | "unpublish" | "restore" | "archive" | "delete";

export interface FormActionOption {
  action: FormStatusAction;
  label: string;
  subtitle: string;
  /** The status this moves the form to — absent for delete. */
  target?: FormStatus;
  danger?: boolean;
  /** Set when the action exists but can't run right now. */
  disabledReason?: string;
}

/** Every status move a form offers right now, primary first — shared by the
 *  builder's StatusControl and the forms table so the two can't drift.
 *  Mirrors the backend: an archived form goes back to draft before it can be
 *  republished, and a form with responses can be archived but never deleted.
 *  `lockedReason` (an archived tournament) disables every move with that reason. */
export function formStatusActions(
  form: { status: FormStatus; response_count: number },
  lockedReason?: string,
): FormActionOption[] {
  const options = statusMoves(form);
  return lockedReason ? options.map((option) => ({ ...option, disabledReason: lockedReason })) : options;
}

function statusMoves(form: { status: FormStatus; response_count: number }): FormActionOption[] {
  const primary: FormActionOption =
    form.status === "draft"
      ? { action: "publish", label: "Publish", subtitle: "Start accepting responses", target: "published" }
      : form.status === "published"
        ? { action: "unpublish", label: "Unpublish", subtitle: "Stop accepting responses, back to draft", target: "draft" }
        : { action: "restore", label: "Restore to draft", subtitle: "Unarchive it for review", target: "draft" };

  return [
    primary,
    ...(form.status !== "archived"
      ? [{ action: "archive", label: "Archive", subtitle: "Stop accepting responses", target: "archived" } as FormActionOption]
      : []),
    {
      action: "delete",
      label: "Delete",
      subtitle: "Permanently remove this form",
      danger: true,
      disabledReason: form.response_count > 0 ? "Archive instead — this form already has responses" : undefined,
    },
  ];
}
