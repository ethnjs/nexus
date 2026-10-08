"use client";

/**
 * The assignments board's drag context, hoisted above the tournament shell
 * (see app/dashboard/tournaments/[id]/layout.tsx) rather than living in the
 * page.
 *
 * It has to live above the shell because the member belt is
 * rendered through the layout's panel slot, which is a sibling of <main> —
 * not a descendant of it. React context flows by tree position, so a
 * DndContext inside the page cannot reach a panel rendered outside it, and
 * every card in the belt silently stops being draggable.
 *
 * The page still owns the behaviour: it registers its handlers here, and this
 * only supplies the context and the overlay.
 */
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection,
  useDndMonitor, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent, type Modifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";

/**
 * Whatever is under the cursor, falling back to rectangles.
 *
 * The board's targets nest and differ wildly in size: a track's timeline body
 * means "every shift on this track", and the strip of shift headers sitting
 * inside it means one of them. dnd-kit's default picks whichever rectangle
 * the *dragged item* overlaps most, which for a chip taller than the header
 * strip is always the body — the header could not be hit at all.
 *
 * The fallback matters for keyboard drags, which have no pointer: there
 * `pointerWithin` returns nothing and rectangles are the only answer.
 */
const underCursor: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

/**
 * Pins the overlay's top-left corner to the cursor rather than to wherever
 * the card was grabbed.
 *
 * dnd-kit positions the overlay over the *source node's* rect and then
 * translates it by the pointer delta — so grabbing a tall member card by its
 * bottom edge leaves the little chip floating up where the card's name was.
 * Adding the grab offset back (cursor minus the node's top-left) cancels
 * that, which is what @dnd-kit/modifiers' snapCenterToCursor does; it's four
 * lines, so it lives here rather than as another dependency.
 *
 * The corner, not the chip's centre, because the modifier cannot know the
 * chip's size: dnd-kit forces the overlay wrapper to the *source card's*
 * width and height, so the rect here is the card's. The chip centres itself
 * on that corner in CSS below, where its own box is the one being measured.
 */
const followCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!activatorEvent || !draggingNodeRect) return transform;
  const grabbedAt = getEventCoordinates(activatorEvent);
  if (!grabbedAt) return transform;
  return {
    ...transform,
    x: transform.x + grabbedAt.x - draggingNodeRect.left,
    y: transform.y + grabbedAt.y - draggingNodeRect.top,
  };
};

/**
 * Auto-scrolling, by what the cursor is over rather than by where the drag
 * started.
 *
 * dnd-kit scrolls the scrollable ancestors of the *dragged node* whenever it
 * has no drop target under the cursor — and a member card's nearest
 * scrollable ancestor is the belt it was picked up from. The shell's <main>
 * is its own scroll container (Shell.module.css: the shell is 100dvh and
 * overflow:hidden, so the document itself never scrolls) and is no ancestor
 * of the belt at all, which is why dragging toward the bottom of the screen
 * scrolled the panel and the board stayed put.
 *
 * Hit-testing the pointer answers the question directly: carry a card over
 * the board and the board scrolls; over the belt and the belt does. Both the
 * target and the speed are sticky — a pointer that stops arriving (dragged
 * onto the taskbar, off the window) leaves the last ones standing, so the
 * scroll keeps running until you steer it back. It needs
 * the overlay to be transparent to hit-testing, which is why DragOverlay
 * below is given pointerEvents: none — it is centred on the cursor, so
 * otherwise it is the only thing elementFromPoint would ever find.
 */
const SCROLL_EDGE = 72;
const SCROLL_MAX_SPEED = 16;

/** The nearest ancestor of `from` that scrolls vertically and has content to
 *  scroll. Direction is deliberately not considered: a container at its
 *  bottom is still the one the cursor is over, and scrollTop clamps itself —
 *  skipping it here would silently hand the gesture to a container the
 *  cursor left. */
function scrollableFrom(from: Element | null): HTMLElement | null {
  for (let node = from; node instanceof HTMLElement; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
    if (node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

/** How fast to scroll from how deep into a container's edge zone the cursor
 *  is: nothing until the last SCROLL_EDGE px, then linear to full speed at
 *  the edge itself. */
function edgeSpeed(y: number, top: number, bottom: number): number {
  if (y > bottom - SCROLL_EDGE) {
    return Math.min(1, (y - (bottom - SCROLL_EDGE)) / SCROLL_EDGE) * SCROLL_MAX_SPEED;
  }
  if (y < top + SCROLL_EDGE) {
    return -Math.min(1, ((top + SCROLL_EDGE) - y) / SCROLL_EDGE) * SCROLL_MAX_SPEED;
  }
  return 0;
}

function useCursorAutoScroll(dragging: boolean) {
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    let container: HTMLElement | null = null;
    let speed = 0;

    function aim(e: PointerEvent) {
      // Clamped to the viewport: past its edge the cursor is over the
      // browser chrome or the desktop, and "as far down as you can go" is
      // still a perfectly clear instruction — it just reads as full speed
      // rather than as no target.
      const x = Math.min(Math.max(e.clientX, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(e.clientY, 0), window.innerHeight - 1);
      // The viewport's own edges, not the container's: the belt and the
      // board both run the full height of the shell, and a container taller
      // than the screen would otherwise put its edge zone off-screen.
      speed = edgeSpeed(y, 0, window.innerHeight);
      if (speed === 0) return;
      // Whatever scrolls under the cursor — but the last one stays in force
      // when there is nothing there, which is the whole point of the edge
      // zones: they overlap the dashboard's top bar and the panel's header,
      // neither of which scrolls, and stopping there would mean the scroll
      // died exactly where you were steering it.
      const found = scrollableFrom(document.elementFromPoint(x, y));
      if (found) container = found;
    }
    function step() {
      if (container && speed !== 0) container.scrollTop += speed;
      frame = requestAnimationFrame(step);
    }

    window.addEventListener("pointermove", aim);
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("pointermove", aim);
      cancelAnimationFrame(frame);
    };
  }, [dragging]);
}

/** What a drop target calls itself in the overlay's "assigning to" line.
 *  Every droppable on the board carries one in its `data`. */
interface DropTargetData {
  label?: string;
}

/**
 * The name of whatever the cursor is over, riding under the dragged chip.
 *
 * In the overlay rather than anchored to the target, because the target the
 * cursor found can be a 60px strip of header halfway up a scrolled page —
 * the one place a label is guaranteed to be both visible and next to the
 * thing you are aiming with is the cursor itself.
 *
 * useDndMonitor, not useDndContext: the monitor fires when `over` *changes*,
 * so this re-renders per target crossed rather than per frame.
 */
function AssigningTo() {
  const [label, setLabel] = useState<string | null>(null);
  useDndMonitor({
    onDragOver: ({ over }) => setLabel((over?.data.current as DropTargetData | undefined)?.label ?? null),
    onDragEnd: () => setLabel(null),
    onDragCancel: () => setLabel(null),
  });
  if (!label) return null;
  return (
    <div style={{
      padding: "3px 7px", borderRadius: "var(--radius-sm)",
      background: "var(--color-text-primary)", color: "var(--color-surface)",
      fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500,
      whiteSpace: "nowrap",
    }}>
      Assigning to {label}
    </div>
  );
}

interface BoardDndHandlers {
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  /** What follows the cursor, resolved once from the active draggable's id. */
  renderOverlay?: (activeId: string) => ReactNode;
  /** The dragged person's name, for surfaces that draw their own preview of
   *  the drop — the timeline's ghost row. Same resolution as the overlay:
   *  once, at drag start, from whichever surface owns the draggable. */
  labelFor?: (activeId: string) => string | null;
}

const RegisterContext = createContext<((id: string, handlers: BoardDndHandlers) => void) | null>(null);

/**
 * "Is a drag in flight" as its own one-boolean context.
 *
 * Deliberately not useDndContext(): dnd-kit rebuilds that context's value on
 * every pointer move — `collisions` is recomputed inline each render and is a
 * fresh array each time — so a component reading it re-renders per frame, not
 * per drag. This flips exactly twice, on start and on end.
 */
const DraggingContext = createContext(false);
/** The dragged person's name while a drag is in flight, null otherwise.
 *  Flips on the same two renders DraggingContext does. */
const DragLabelContext = createContext<string | null>(null);

/** Whether any drag is in flight. Safe to read from a memoised subtree. */
export function useBoardDragging() {
  return useContext(DraggingContext);
}

/** Who is being dragged, for a surface drawing its own drop preview. */
export function useBoardDragLabel() {
  return useContext(DragLabelContext);
}

/**
 * Registers one surface's drag behaviour with the provider above it.
 *
 * `id` because there can be more than one at a time: the assignments board
 * owns the page while a member panel docked beside it owns its own timeline,
 * and both are inside this one context. Every registered handler sees every
 * drag, so each must ignore the ones it doesn't recognise — which they
 * already do, since both check the target's `kind` before acting.
 */
export function useRegisterBoardDnd(id: string, handlers: BoardDndHandlers) {
  const register = useContext(RegisterContext);
  useEffect(() => { register?.(id, handlers) });
}

export function BoardDndProvider({ children }: { children: ReactNode }) {
  // Handlers in a ref, not state: they are rebuilt on every render of every
  // registered surface, and storing them would loop. Keyed by surface, so a
  // panel registering doesn't silently unregister the board underneath it.
  const handlers = useRef(new Map<string, BoardDndHandlers>());
  // The overlay is resolved once, when the drag starts, and held as state.
  // Reading the ref during render would be both a lint error and a real
  // staleness bug — a ref write does not schedule the render that would show
  // its new value.
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const [dragging, setDragging] = useState(false);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  useCursorAutoScroll(dragging);

  const register = useCallback((id: string, next: BoardDndHandlers) => {
    handlers.current.set(id, next);
  }, []);

  /** The first surface that claims this drag. An overlay belongs to whoever
   *  owns the draggable, so the others return null for ids they don't know. */
  function renderOverlay(activeId: string): ReactNode {
    for (const entry of handlers.current.values()) {
      const overlay = entry.renderOverlay?.(activeId);
      if (overlay) return overlay;
    }
    return null;
  }

  /** Same first-claim rule as the overlay: a surface returns null for ids it
   *  doesn't own. */
  function labelFor(activeId: string): string | null {
    for (const entry of handlers.current.values()) {
      const label = entry.labelFor?.(activeId);
      if (label) return label;
    }
    return null;
  }

  const sensors = useSensors(
    // A small threshold so a click on a card is not swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  return (
    <RegisterContext.Provider value={register}>
      <DndContext
        sensors={sensors}
        collisionDetection={underCursor}
        // Ours instead, above — dnd-kit's scrolls whatever the *card* sits
        // inside, which is the belt it never leaves.
        autoScroll={false}
        onDragStart={(event) => {
          setDragging(true);
          setOverlay(renderOverlay(String(event.active.id)));
          setDragLabel(labelFor(String(event.active.id)));
          for (const entry of handlers.current.values()) entry.onDragStart?.(event);
        }}
        onDragEnd={(event) => {
          setDragging(false);
          setOverlay(null);
          setDragLabel(null);
          for (const entry of handlers.current.values()) entry.onDragEnd?.(event);
        }}
        onDragCancel={() => { setDragging(false); setOverlay(null); setDragLabel(null) }}
      >
        <DraggingContext.Provider value={dragging}>
          <DragLabelContext.Provider value={dragLabel}>{children}</DragLabelContext.Provider>
        </DraggingContext.Provider>
        {/* No drop animation: the overlay is pinned to the cursor, so the
            default one flies it back to the card it was grabbed from — a
            chip sailing across the page after the drop already landed. */}
        {/* Transparent to hit-testing: it sits under the cursor by design,
            and the auto-scroller asks what the cursor is over. */}
        <DragOverlay
          modifiers={[followCursor]}
          dropAnimation={null}
          style={{ pointerEvents: "none" }}
        >
          {overlay && (
            // The wrapper dnd-kit sizes is the source card's box, so nothing
            // inside it can be laid out against the chip — both pieces hang
            // off its top-left corner, which the modifier above has parked
            // under the cursor. translate(-50%) on the chip is what actually
            // centres it there, since only CSS knows how big it is.
            <div style={{ position: "relative", width: 0, height: 0 }}>
              {/* max-content, or the name wraps to one word per line: an
                  absolutely positioned box shrinks to fit its containing
                  block, and this one's is the zero-width anchor. */}
              <div style={{
                position: "absolute", top: 0, left: 0, transform: "translate(-50%, -50%)",
                width: "max-content",
              }}>
                {overlay}
              </div>
              {/* Below the chip, clear of the cursor: a label under the
                  pointer is the one thing you cannot read while aiming. */}
              <div style={{
                position: "absolute", top: "22px", left: 0, transform: "translateX(-50%)",
                width: "max-content", display: "flex", justifyContent: "center",
              }}>
                <AssigningTo />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </RegisterContext.Provider>
  );
}
