"use client";

import { createContext, useContext } from "react";

// Lets a control deep inside an expanded card tell FieldList "this height
// change is mine — don't chase the card with the viewport." Deleting an
// option is the case that needs it: the row vanishing shrinks the card, and
// every heuristic that decides where a card *should* sit reads as a reason to
// scroll when the honest answer is "the user is mid-cleanup, hold still."
//
// A context rather than a prop chain because the callers are three levels
// down (OptionsEditor <- QuestionRenderer <- FieldCard), and a no-op default
// so those components still work outside the form editor.
export const SuspendCardScrollContext = createContext<() => void>(() => {});

export function useSuspendCardScroll() {
  return useContext(SuspendCardScrollContext);
}
