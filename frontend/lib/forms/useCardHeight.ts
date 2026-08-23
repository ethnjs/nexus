"use client";

import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

const DURATION_MS = 220;
const EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";

// Animates an element between its old and new height whenever `state` changes.
//
// Height, not a CSS transition: expanding a field card swaps one subtree for a
// completely different one (the respondent-facing preview for the editor), so
// there's no shared element to transition and no known target height — both
// ends have to be measured.
//
// While it runs, the element carries data-animating. That's the whole contract
// for anyone else who measures this element (FieldList's scroll-into-view):
// a height in motion is not a height worth reacting to, and a data attribute
// says so without threading state through the component tree.
export function useCardHeight(ref: RefObject<HTMLElement | null>, state: unknown, skip = false) {
  // Last height the element came to rest at — the "from" of the next
  // animation. Tracked by ResizeObserver rather than measured during render,
  // so N cards don't each force a layout on every keystroke.
  const restingRef = useRef<number | null>(null);
  const animRef = useRef<Animation | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!animRef.current) restingRef.current = el.offsetHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    const from = restingRef.current;
    // from == null is the first commit — there's no previous height to leave.
    if (!el || from == null || skip || prefersReducedMotion()) return;

    // Runs after the children's layout effects, so autoGrow textareas have
    // already sized themselves and this is the real resting height.
    const to = el.offsetHeight;
    if (Math.abs(to - from) < 2) return;

    animRef.current?.cancel();
    el.dataset.animating = "true";
    // The outgoing content is still its old size for a frame or two.
    el.style.overflow = "hidden";

    const animation = el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: DURATION_MS, easing: EASING },
    );
    animRef.current = animation;

    const settle = () => {
      if (animRef.current !== animation) return;
      animRef.current = null;
      delete el.dataset.animating;
      el.style.overflow = "";
      restingRef.current = el.offsetHeight;
    };
    // cancel() rejects `finished`; the cleanup below settles that case itself.
    animation.finished.then(settle, () => {});
    return () => {
      animation.cancel();
      settle();
    };
  }, [ref, state, skip]);
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
