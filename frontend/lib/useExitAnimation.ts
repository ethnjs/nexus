import { useCallback, useEffect, useRef } from "react";

// How long the ghost stays up; matches the modal-*-out keyframes in globals.css.
const EXIT_MS = 140;

/**
 * Plays a modal's close animation, however it closes.
 *
 * Most modals close by their parent no longer rendering them, so React
 * removes the DOM before anything could animate. Instead, on unmount this
 * leaves a copy of the last frame in the page, inert, plays the reverse of
 * the open animation on it, and removes it — no caller has to change how it
 * closes. Returns a callback ref for the modal's outermost element.
 */
export function useExitAnimation<T extends HTMLElement>() {
  const node = useRef<T | null>(null);

  // Kept through React's own detach (the callback gets null on unmount), so
  // the cleanup below still has the element to copy.
  const ref = useCallback((element: T | null) => {
    if (element) node.current = element;
  }, []);

  useEffect(() => () => {
    const element = node.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ghost = element.cloneNode(true) as HTMLElement;
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("role");
    ghost.classList.add("modal-closing");
    document.body.appendChild(ghost);
    window.setTimeout(() => ghost.remove(), EXIT_MS);
  }, []);

  return ref;
}
