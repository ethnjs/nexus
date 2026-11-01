/**
 * Ref for a table's `.header` row that keeps it pinned to the top of the page
 * while the rest of its table is on screen.
 *
 * The header is `position: sticky` (Table.module.css), but every table card
 * scrolls sideways (`.scroll`), and overflow-x: auto makes the card the
 * header's scroll container on both axes, so sticky would only stick within a
 * card that never scrolls vertically. So while the table fits its card, the
 * card is switched to overflow-x: clip, which isn't a scroll container, and
 * sticky pins against the page. Only a table wider than its card keeps
 * sideways scrolling, and there the header is translated instead — a frame
 * behind a fast scroll, since scrolling runs off the main thread.
 */
export function stickyHeader(header: HTMLElement | null) {
  if (!header) return;
  const table = header.parentElement;
  const card = table?.parentElement;
  if (!table || !card) return;
  // Only a `.scroll` card is switched; anything else is left as it is.
  const cardScrolls = getComputedStyle(card).overflowX === "auto";
  let fits = true;
  let offset = 0;
  let frame = 0;

  // The table's own width rather than the card's scrollWidth, which clip
  // would hide, so this never has to switch the card back to measure.
  function measureFit() {
    if (!table || !card || !cardScrolls) return;
    const style = getComputedStyle(card);
    const content =
      card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    fits = table.offsetWidth <= content + 0.5;
    card.style.overflowX = fits ? "clip" : "";
  }

  function verticalScroller(): HTMLElement | null {
    for (let el = card?.parentElement; el; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight)
        return el;
    }
    return null;
  }

  function setOffset(next: number) {
    if (!header || next === offset) return;
    offset = next;
    header.style.transform = offset ? `translateY(${offset}px)` : "";
  }

  function place() {
    frame = 0;
    if (!header || !table || !card) return;
    const scroller = verticalScroller();
    const scrollerTop = scroller?.getBoundingClientRect().top ?? 0;
    if (fits) {
      // Sticky measures from inside the scroller's padding (main's 22px), so
      // without this the header pins that far below the top bar.
      const top = scroller ? `-${getComputedStyle(scroller).paddingTop}` : "";
      if (header.style.top !== top) header.style.top = top;
      setOffset(0);
      header.dataset.stuck =
        scroller && header.getBoundingClientRect().top <= scrollerTop + 0.5 ? "true" : "";
      return;
    }
    let next = 0;
    if (scroller) {
      const naturalTop = header.getBoundingClientRect().top - offset;
      const room = table.getBoundingClientRect().bottom - header.offsetHeight - naturalTop;
      next = Math.max(0, Math.min(scrollerTop - naturalTop, room));
    }
    setOffset(next);
    header.dataset.stuck = next ? "true" : "";
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(place);
  };

  // Capture, since scroll events don't bubble and the scroller is an ancestor.
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  const observer = new ResizeObserver(() => {
    measureFit();
    schedule();
  });
  observer.observe(table);
  observer.observe(card);
  measureFit();
  schedule();

  return () => {
    document.removeEventListener("scroll", schedule, { capture: true });
    observer.disconnect();
    cancelAnimationFrame(frame);
    if (cardScrolls) card.style.overflowX = "";
  };
}
