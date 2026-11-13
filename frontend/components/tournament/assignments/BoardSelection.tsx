"use client";

import { createContext, useContext } from "react";

/** The board's select mode: who is ticked, by membership id. */
export interface BoardSelection {
  active: boolean;
  ids: ReadonlySet<number>;
  toggle: (membershipId: number) => void;
}

const NONE: BoardSelection = { active: false, ids: new Set(), toggle: () => {} };

/**
 * Context rather than props: chips sit four memoised layers under the page,
 * and only the chips themselves need to re-render when a tick changes.
 */
export const BoardSelectionContext = createContext<BoardSelection>(NONE);

export function useBoardSelection() {
  return useContext(BoardSelectionContext);
}
