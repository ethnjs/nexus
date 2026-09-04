import { PendingUpdateReason } from "@/lib/api";

// Copy for the pending-update reasons the server produces. The rules
// themselves live in backend/app/core/form/changes.py and are read via
// formsApi.classifyFieldChanges — deriving them a second time here is what
// would let the save confirmation quietly under-report.

export const REASON_LABELS: Record<PendingUpdateReason, string> = {
  question_type_changed: "The answer format changed",
  option_added: "An option was added",
  option_invalidated: "An option was removed",
  option_regrouped: "An option covers different shifts or events",
  now_required: "This question is now required",
  key_changed: "Switched between a preset and a standard question",
  text_changed: "The wording changed",
};

/** What the TD is actually weighing, for the judgment calls only. */
export const REASON_CONSEQUENCES: Partial<Record<PendingUpdateReason, string>> = {
  key_changed:
    "Their answers won't reach availability, lunch or track status unless they resubmit.",
  text_changed:
    "Only ask again if the new wording changes what you're asking for.",
};
