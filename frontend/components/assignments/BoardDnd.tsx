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

const RegisterContext = createContext<((handlers: BoardDndHandlers) => void) | null>(null);

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

/** Registers this page's drag behaviour with the provider above it. */
export function useRegisterBoardDnd(handlers: BoardDndHandlers) {
  const register = useContext(RegisterContext);
  useEffect(() => { register?.(handlers) });
}

export function BoardDndProvider({ children }: { children: ReactNode }) {
  // Handlers in a ref, not state: they are rebuilt on every page render, and
  // storing them would loop.
  const handlers = useRef<BoardDndHandlers>({});
  // The overlay is resolved once, when the drag starts, and held as state.
  // Reading the ref during render would be both a lint error and a real
  // staleness bug — a ref write does not schedule the render that would show
  // its new value.
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const [dragging, setDragging] = useState(false);

  const register = useCallback((next: BoardDndHandlers) => { handlers.current = next }, []);

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
          setOverlay(handlers.current.renderOverlay?.(String(event.active.id)) ?? null);
          handlers.current.onDragStart?.(event);
        }}
        onDragEnd={(event) => {
          setDragging(false);
          setOverlay(null);
          handlers.current.onDragEnd?.(event);
        }}
        onDragCancel={() => { setDragging(false); setOverlay(null) }}
      >
        <DraggingContext.Provider value={dragging}>{children}</DraggingContext.Provider>
        <DragOverlay>{overlay}</DragOverlay>
      </DndContext>
    </RegisterContext.Provider>
  );
}
