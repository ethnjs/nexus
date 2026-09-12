"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keeping the open docked panel in the page's URL, so a refresh — or a
 * pasted link — comes back to it.
 *
 * Split in two on purpose. The id the URL arrived with is needed *before* the
 * state that holds it exists (usePanelSelection takes it as its initial
 * value), while the mirror back out can only run once that state is there.
 * One hook taking both would have to be called at two different points.
 *
 * Strictly one direction each: the URL is read once, on first render, and
 * written from state from then on. A hook that kept reading it would fight
 * the replace below, since the router hands back the value the effect just
 * wrote.
 */

/** The panel id this page was loaded with, or null. Read once — the caller
 *  owns it from then on. */
export function useInitialPanelId(param: string): number | null {
  const searchParams = useSearchParams();
  const [initialId] = useState(() => Number(searchParams.get(param)) || null);
  return initialId;
}

/**
 * Mirrors whichever row's panel is open into `?param=<id>`.
 *
 * replace, not push: this is where you already are, and every row you click
 * would otherwise cost a Back press to undo. Writes the whole query string,
 * so a page carrying other params of its own would need this to merge rather
 * than replace — none of them do; filters and columns live server-side in the
 * viewer's display config, which already survives a refresh.
 */
export function usePanelUrlSync(param: string, openId: number | null): void {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const search = openId !== null ? `?${param}=${openId}` : "";
    if (search === window.location.search) return;
    router.replace(`${pathname}${search}`, { scroll: false });
  }, [param, openId, pathname, router]);
}
