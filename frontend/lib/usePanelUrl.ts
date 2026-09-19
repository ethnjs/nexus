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
 * would otherwise cost a Back press to undo. Only its own param is touched, so
 * a page with others (the buildings page's ?track=) keeps them.
 */
export function usePanelUrlSync(param: string, openId: number | null): void {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (openId !== null) params.set(param, String(openId));
    else params.delete(param);
    const query = params.toString();
    const search = query ? `?${query}` : "";
    if (search === window.location.search) return;
    router.replace(`${pathname}${search}`, { scroll: false });
  }, [param, openId, pathname, router]);
}
