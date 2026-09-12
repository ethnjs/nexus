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
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";

interface BoardDndHandlers {
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  /** What follows the cursor, resolved once from the active draggable's id. */
  renderOverlay?: (activeId: string) => ReactNode;
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

/** Whether any drag is in flight. Safe to read from a memoised subtree. */
export function useBoardDragging() {
  return useContext(DraggingContext);
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

  const sensors = useSensors(
    // A small threshold so a click on a card is not swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  return (
    <RegisterContext.Provider value={register}>
      <DndContext
        sensors={sensors}
        onDragStart={(event) => {
          setDragging(true);
          setOverlay(renderOverlay(String(event.active.id)));
          for (const entry of handlers.current.values()) entry.onDragStart?.(event);
        }}
        onDragEnd={(event) => {
          setDragging(false);
          setOverlay(null);
          for (const entry of handlers.current.values()) entry.onDragEnd?.(event);
        }}
        onDragCancel={() => { setDragging(false); setOverlay(null) }}
      >
        <DraggingContext.Provider value={dragging}>{children}</DraggingContext.Provider>
        <DragOverlay>{overlay}</DragOverlay>
      </DndContext>
    </RegisterContext.Provider>
  );
}
