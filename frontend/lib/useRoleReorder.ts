"use client";

import { ComponentProps, CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragEndEvent, DragMoveEvent, PointerSensor,
  closestCenter, useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ApiError, Role, rolesApi } from "@/lib/api";
import { DropZoneKind, applyDrop, groupByRank, rankChanges } from "@/lib/roleReorder";

export type DividerState = "success" | "noop" | null;

// The DndContext props the hook owns — spread onto a <DndContext> anywhere the
// role list is rendered (settings index, future role left-nav).
type DndProps = Pick<
  ComponentProps<typeof DndContext>,
  "sensors" | "collisionDetection" | "onDragMove" | "onDragOver" | "onDragEnd" | "onDragCancel"
>;

interface UseRoleReorderOptions {
  tournamentId: number;
  /** Last-saved roles from the server; becomes the baseline the draft diffs against. */
  roles: Role[] | null;
  isLocked: (role: Role) => boolean;
  /** Called with the saved roles so the caller can adopt them without a GET. */
  onSaved?: (roles: Role[]) => void;
}

export interface RoleReorder {
  draft: Role[];
  groups: Role[][];
  isDirty: boolean;
  saving: boolean;
  error?: string;
  save: () => Promise<void>;
  cancel: () => void;
  dndProps: DndProps;
  /** Set only while hovering a role to join its tie group; above/below show on dividers. */
  dropIndicatorFor: (role: Role) => { noop: boolean } | null;
  dividerStateFor: (prev: Role | null, next: Role | null) => DividerState;
}

export function useRoleReorder({ tournamentId, roles, isLocked, onSaved }: UseRoleReorderOptions): RoleReorder {
  const [draft, setDraft] = useState<Role[]>(roles ?? []);
  const [dropZone, setDropZone] = useState<{ id: number; zone: DropZoneKind; noop: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // True on mount and right after this hook's own save — a clean reset onto
  // the new `roles` is correct there. Any other `roles` change (e.g. another
  // part of the page creating a role) means someone else's action shouldn't
  // silently discard an in-progress unsaved drag — merge instead: keep the
  // draft's pending order for roles still present, append anything new.
  const expectResetRef = useRef(true);

  useEffect(() => {
    const source = roles ?? [];
    setDraft((prevDraft) => {
      if (expectResetRef.current) {
        expectResetRef.current = false;
        return source;
      }
      const sourceIds = new Set(source.map((r) => r.id));
      const draftIds = new Set(prevDraft.map((r) => r.id));
      const kept = prevDraft.filter((r) => sourceIds.has(r.id));
      const added = source.filter((r) => !draftIds.has(r.id));
      return [...kept, ...added];
    });
    setError(undefined);
  }, [roles]);

  // Drag handlers read live values through refs so their identity stays stable
  // across the many re-renders a single drag causes.
  const draftRef = useRef(draft);
  const lockedRef = useRef(isLocked);
  const dropZoneRef = useRef(dropZone);
  draftRef.current = draft;
  lockedRef.current = isLocked;
  dropZoneRef.current = dropZone;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Wired to onDragMove as well as onDragOver: dnd-kit only fires onDragOver
  // when over.id *changes*, which sampled the zone once per row crossing — so
  // "above" on the first row, "below" on the last, and "join" anywhere were
  // unreachable, since nothing is ever crossed into there.
  const handleDragOver = useCallback((event: DragMoveEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) { setDropZone(null); return; }

    const rect = active.rect.current.translated;
    if (!rect) { setDropZone(null); return; }

    const centerY = rect.top + rect.height / 2;
    const relative = (centerY - over.rect.top) / over.rect.height;
    const zone: DropZoneKind = relative < 0.3 ? "above" : relative > 0.7 ? "below" : "join";

    const targetId = Number(over.id);
    const noop = applyDrop(draftRef.current, Number(active.id), targetId, zone, lockedRef.current) === null;
    // Runs on every pointer move — keep the object identity stable when nothing
    // changed so memoized rows and dividers don't re-render.
    setDropZone((prev) =>
      prev && prev.id === targetId && prev.zone === zone && prev.noop === noop
        ? prev
        : { id: targetId, zone, noop },
    );
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const zone = dropZoneRef.current;
    setDropZone(null);
    if (!zone) return;
    // Target comes from the previewed zone, not the event's `over`, so what
    // gets applied is always what the indicator was showing.
    const next = applyDrop(draftRef.current, Number(event.active.id), zone.id, zone.zone, lockedRef.current);
    if (next) setDraft(next);
  }, []);

  const dndProps = useMemo<DndProps>(() => ({
    sensors,
    collisionDetection: closestCenter,
    onDragMove: handleDragOver,
    onDragOver: handleDragOver,
    onDragEnd: handleDragEnd,
    onDragCancel: () => setDropZone(null),
  }), [sensors, handleDragOver, handleDragEnd]);

  const groups = useMemo(() => groupByRank(draft), [draft]);

  const isDirty = useMemo(() => {
    const key = (list: Role[]) => JSON.stringify(list.map((r) => [r.id, r.rank]));
    return key(roles ?? []) !== key(draft);
  }, [roles, draft]);

  const dropIndicatorFor = useCallback((role: Role) => (
    dropZone?.id === role.id && dropZone.zone === "join" ? { noop: dropZone.noop } : null
  ), [dropZone]);

  // A divider between `prev` and `next` lights up if the drop zone points at
  // either side of that same boundary — hovering the bottom of `prev` and the
  // top of `next` mean the same insertion point.
  const dividerStateFor = useCallback((prev: Role | null, next: Role | null): DividerState => {
    if (!dropZone) return null;
    // Never light a boundary internal to a tie group.
    if (prev && next && prev.rank === next.rank) return null;
    const matches =
      (prev && dropZone.id === prev.id && dropZone.zone === "below") ||
      (next && dropZone.id === next.id && dropZone.zone === "above");
    if (!matches) return null;
    return dropZone.noop ? "noop" : "success";
  }, [dropZone]);

  const save = useCallback(async () => {
    const changes = rankChanges(roles ?? [], draftRef.current);
    if (changes.length === 0) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await rolesApi.reorderBulk(tournamentId, changes);
      // Adopt the server's ranks as the new baseline instead of re-GETting.
      expectResetRef.current = true;
      const ranks = new Map(updated.map((r) => [r.id, r.rank]));
      onSaved?.(draftRef.current.map((r) => {
        const rank = ranks.get(r.id);
        return rank === undefined ? r : { ...r, rank };
      }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to save role order.");
    } finally {
      setSaving(false);
    }
  }, [tournamentId, roles, onSaved]);

  const cancel = useCallback(() => {
    setDraft(roles ?? []);
    setDropZone(null);
    setError(undefined);
  }, [roles]);

  return { draft, groups, isDirty, saving, error, save, cancel, dndProps, dropIndicatorFor, dividerStateFor };
}

// Per-row drag/drop wiring. Kept separate because useDraggable/useDroppable
// must run inside the row component itself, not the list that owns the state.
export function useRoleRowDrag(roleId: number, locked: boolean) {
  const { attributes, listeners, setNodeRef: setGripRef, transform, isDragging } = useDraggable({
    id: roleId,
    disabled: locked,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: roleId, disabled: locked });

  // Only the dragged row moves — siblings never shift to preview a reorder the
  // way a sortable list would.
  const dragStyle: CSSProperties = isDragging
    ? { transform: CSS.Translate.toString(transform), opacity: 0.5, position: "relative", zIndex: 1 }
    : {};

  return { setGripRef, gripProps: { ...attributes, ...listeners }, setDropRef, dragStyle, isDragging };
}
