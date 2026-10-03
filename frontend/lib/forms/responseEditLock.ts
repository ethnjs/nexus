// Why a member can't edit their submitted response, or undefined when they
// can — one wording on the overview's Forms card and the form's own page.

export const RESPONSE_NOT_ACCEPTING = "This form isn't accepting changes right now.";
export const RESPONSE_EDITS_LOCKED = "Editing is locked. Contact your tournament director if something needs changing.";

export function responseEditLockedReason(form: {
  status: string;
  allow_response_edits: boolean;
  tournamentArchived: boolean;
  /** Flagged questions open editing even with edits off — the TD asked again. */
  hasFlaggedQuestions?: boolean;
}): string | undefined {
  if (form.status !== "published" || form.tournamentArchived) return RESPONSE_NOT_ACCEPTING;
  if (!form.allow_response_edits && !form.hasFlaggedQuestions) return RESPONSE_EDITS_LOCKED;
  return undefined;
}
