"use client";

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { MenuHeading, MenuItem, MenuNote } from "@/components/ui/DrillMenu";
import {
  FilterConditionRow,
  fieldPickerItems,
  LeadCell,
  type LinePosition,
  linePosition,
  rowWidth,
} from "@/components/ui/FilterConditionRow";
import { FormPopover } from "@/components/ui/FormPopover";
import { IconEdit, IconGripVertical, IconPlus, IconTrash } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { ApiError, type FilterCondition, type FilterGroup, type SavedFilter } from "@/lib/api";
import {
  conditionProblem,
  type FilterField,
  fieldMap,
  isGroup,
  pruneFilter,
  sameFilter,
} from "@/lib/filters/model";
import { suggestConditions } from "@/lib/filters/quickAdd";
import type { SavedFilters } from "@/lib/filters/useSavedFilters";
import styles from "./FilterBuilderModal.module.css";

type Join = FilterGroup["op"];

// ─── Draft ────────────────────────────────────────────────────────────────
// The filter being edited, with an id on every row and group so they can be
// dragged and keyed. Converted from and back to a FilterGroup at the edges.

interface DraftRow {
  id: string;
  condition: FilterCondition;
}

interface DraftGroup {
  id: string;
  op: Join;
  rows: DraftRow[];
}

type DraftItem = DraftRow | DraftGroup;

interface Draft {
  op: Join;
  items: DraftItem[];
}

const MIN_WIDTH = 720;
const MAX_WIDTH = 1440;
// The modal's own padding, both sides, and a little over: the row widths are
// worked out, not measured, and a row a pixel short of fitting would wrap.
const PANEL_PADDING = 56 + 4;
// A group's grip, lead, box border and padding, left and right of its rows.
const GROUP_INSET = 14 + 8 + 56 + 8 + 2 + 24;

const ROOT = "root";
// Prefixes the droppable inside a group, as against the group's own handle.
const INSIDE = "in:";
let lastId = 0;
const newId = (kind: "r" | "g") => `${kind}${++lastId}`;
const isGroupId = (id: string) => id.startsWith("g");

const isDraftGroup = (item: DraftItem): item is DraftGroup => "rows" in item;

function blankRow(): DraftRow {
  return { id: newId("r"), condition: { field: "", group: null, op: "any_of", values: [] } };
}

function toDraft(filter: FilterGroup): Draft {
  const items = filter.conditions.map(
    (item): DraftItem =>
      isGroup(item)
        ? {
            id: newId("g"),
            op: item.op,
            rows: item.conditions
              .filter((inner): inner is FilterCondition => !isGroup(inner))
              .map((condition) => ({ id: newId("r"), condition })),
          }
        : { id: newId("r"), condition: item },
  );
  return { op: filter.op, items: items.length > 0 ? items : [blankRow()] };
}

function fromDraft(draft: Draft): FilterGroup {
  return {
    op: draft.op,
    conditions: draft.items.map((item) =>
      isDraftGroup(item)
        ? { op: item.op, conditions: item.rows.map((row) => row.condition) }
        : item.condition,
    ),
  };
}

/** Which list an id sits in: ROOT, or the id of the group holding it. */
function containerOf(items: DraftItem[], id: string): string | undefined {
  if (id.startsWith(INSIDE)) return id.slice(INSIDE.length);
  if (items.some((item) => item.id === id)) return ROOT;
  return items.find((item) => isDraftGroup(item) && item.rows.some((row) => row.id === id))?.id;
}

function listOf(items: DraftItem[], container: string): DraftItem[] {
  if (container === ROOT) return items;
  const group = items.find((item) => item.id === container);
  return group && isDraftGroup(group) ? group.rows : [];
}

function withList(items: DraftItem[], container: string, list: DraftItem[]): DraftItem[] {
  if (container === ROOT) return list;
  return items.map((item) =>
    item.id === container && isDraftGroup(item) ? { ...item, rows: list as DraftRow[] } : item,
  );
}

/** The saved filter a filter came from, if it is unchanged since. */
export function savedFilterMatching(
  saved: SavedFilter[],
  filter: FilterGroup,
): SavedFilter | undefined {
  return filter.conditions.length > 0
    ? saved.find((item) => sameFilter(item.filter, filter))
    : undefined;
}

// ─── Saved filters ────────────────────────────────────────────────────────

/** A name field and Save, for saving the current filter. */
export function SavedFilterNameForm({
  initial = "",
  submitLabel = "Save",
  onSubmit,
  onDone,
}: {
  initial?: string;
  submitLabel?: string;
  onSubmit: (name: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(name.trim());
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "You already have a saved filter with this name."
          : "Couldn't save. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "6px", padding: "6px 10px" }}>
      <div style={{ flex: 1 }}>
        <Input
          autoFocus
          aria-label="Filter name"
          placeholder="Name"
          font="sans"
          size="sm"
          fullWidth
          value={name}
          error={error ?? undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="primary"
        loading={saving}
        disabled={!name.trim()}
        onClick={submit}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

function SavedFiltersMenu({
  saved,
  draft,
  loaded,
  onLoad,
}: {
  saved: SavedFilters;
  draft: FilterGroup;
  loaded: SavedFilter | undefined;
  onLoad: (item: SavedFilter) => void;
}) {
  const [naming, setNaming] = useState<"new" | number | null>(null);
  const changed = loaded !== undefined && !sameFilter(loaded.filter, draft);

  return (
    <FormPopover
      width={300}
      align="right"
      onOpenChange={(open) => !open && setNaming(null)}
      panelStyle={{ padding: "4px 0" }}
      trigger={
        <Button type="button" variant="secondary" size="sm">
          Saved filters
        </Button>
      }
    >
      {(close) => (
        <>
          <MenuHeading>Saved</MenuHeading>
          {saved.items.length === 0 && <MenuNote>Nothing saved yet.</MenuNote>}
          {saved.items.map((item) =>
            naming === item.id ? (
              <SavedFilterNameForm
                key={item.id}
                initial={item.name}
                submitLabel="Rename"
                onSubmit={(name) => saved.update(item.id, { name })}
                onDone={() => setNaming(null)}
              />
            ) : (
              <div
                key={item.id}
                style={{ display: "flex", alignItems: "center", padding: "0 4px" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MenuItem
                    onClick={() => {
                      onLoad(item);
                      close();
                    }}
                  >
                    {item.name}
                  </MenuItem>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title={`Rename ${item.name}`}
                  aria-label={`Rename ${item.name}`}
                  onClick={() => setNaming(item.id)}
                >
                  <IconEdit size={13} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title={`Delete ${item.name}`}
                  aria-label={`Delete ${item.name}`}
                  onClick={() => saved.remove(item.id)}
                  style={{ color: "var(--color-danger)" }}
                >
                  <IconTrash size={13} />
                </Button>
              </div>
            ),
          )}
          <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
          <div style={{ padding: "0 4px" }}>
            {changed && loaded && (
              <MenuItem
                onClick={async () => {
                  await saved.update(loaded.id, { filter: draft });
                  close();
                }}
              >
                Update “{loaded.name}”
              </MenuItem>
            )}
            {naming === "new" ? (
              <SavedFilterNameForm
                onSubmit={async (name) => onLoad(await saved.create(name, draft))}
                onDone={close}
              />
            ) : (
              <MenuItem
                disabledReason={
                  draft.conditions.length === 0 ? "Add a filter to save it." : undefined
                }
                onClick={() => setNaming("new")}
              >
                Save as new…
              </MenuItem>
            )}
          </div>
        </>
      )}
    </FormPopover>
  );
}

// ─── Sortable pieces ──────────────────────────────────────────────────────

function useSortableItem(id: string) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const grip = (
    <span
      {...attributes}
      {...listeners}
      title="Drag to move"
      style={{
        display: "flex",
        cursor: "grab",
        color: "var(--color-text-tertiary)",
        touchAction: "none",
      }}
    >
      <IconGripVertical size={13} />
    </span>
  );
  return {
    setNodeRef,
    grip,
    // Translate, not Transform: rows differ in height, and the scale dnd-kit
    // derives from that would squash the one being dragged.
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    },
  };
}

function SortableRow({ id, render }: { id: string; render: (grip: ReactNode) => ReactNode }) {
  const { setNodeRef, grip, style } = useSortableItem(id);
  return (
    <div ref={setNodeRef} style={style}>
      {render(grip)}
    </div>
  );
}

/** "Where" on the first row and the And/Or button on the second; the tree
 *  line joins the rest. */
function joinLead(index: number, op: Join, onOp: (op: Join) => void): ReactNode {
  if (index === 0) return <span>Where</span>;
  if (index === 1) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="xs"
        title={`Joined with ${op}. Click to switch.`}
        onClick={() => onOp(op === "and" ? "or" : "and")}
        style={{ minWidth: "44px" }}
      >
        <span key={op} className={styles.join}>
          {op === "and" ? "And" : "Or"}
        </span>
      </Button>
    );
  }
  return null;
}

function SortableGroup({
  group,
  lead,
  position,
  onOp,
  onRemove,
  onAdd,
  renderRow,
}: {
  group: DraftGroup;
  lead: ReactNode;
  position: LinePosition;
  onOp: (op: Join) => void;
  onRemove: () => void;
  onAdd: () => void;
  renderRow: (
    row: DraftRow,
    lead: ReactNode,
    position: LinePosition,
    inGroup?: boolean,
  ) => ReactNode;
}) {
  const { setNodeRef, grip, style } = useSortableItem(group.id);
  // Lets a row be dropped into the group, empty or not.
  const { setNodeRef: setInsideRef, isOver } = useDroppable({ id: `${INSIDE}${group.id}` });

  return (
    <div
      ref={setNodeRef}
      className={styles.group}
      style={{ ...style, display: "flex", gap: "8px", alignItems: "flex-start" }}
    >
      <div
        className={styles.reveal}
        style={{ width: "14px", flexShrink: 0, display: "flex", paddingTop: "18px" }}
      >
        {grip}
      </div>
      {/* The tick meets the group's heading, not its middle. */}
      <LeadCell
        position={position}
        style={{ "--tick": "22px", paddingTop: "8px" } as CSSProperties}
      >
        {lead}
      </LeadCell>
      <div
        ref={setInsideRef}
        className={styles.groupBox}
        style={{
          flex: 1,
          minWidth: 0,
          border: `1px solid ${isOver ? "var(--color-border-strong)" : "var(--color-border)"}`,
          borderRadius: "var(--radius-md)",
          background: isOver ? "var(--color-accent-subtle)" : "var(--color-bg)",
          padding: "8px 12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          className={styles.groupHead}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          {group.op === "or" ? "Any" : "All"} of the following are true
          {/* Wrapped: Button sets its own opacity inline, which the hover
              rule can't override. */}
          <span className={styles.reveal} style={{ display: "inline-flex" }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              title="Remove group"
              aria-label="Remove group"
              onClick={onRemove}
              style={{ color: "var(--color-danger)" }}
            >
              <IconTrash size={14} />
            </Button>
          </span>
        </div>
        <SortableContext
          items={group.rows.map((row) => row.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.rows.map((row, j) =>
            renderRow(row, joinLead(j, group.op, onOp), linePosition(j, group.rows.length), true),
          )}
        </SortableContext>
        {group.rows.length === 0 && (
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            Drag filters here, or add one.
          </div>
        )}
        {/* Lined up under the rows' field column: grip, lead and their gaps. */}
        <div style={{ paddingLeft: "76px" }}>
          <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
            <IconPlus size={13} /> Add filter
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

interface FilterBuilderModalProps<Row> {
  title?: string;
  fields: FilterField<Row>[];
  /** The applied filter; the modal edits a draft of it. */
  filter: FilterGroup;
  /** This table's own unfiltered state, when it isn't "no filters". Given,
   *  the footer offers Reset back to it. */
  defaults?: FilterGroup;
  onApply: (filter: FilterGroup) => void;
  onClose: () => void;
  /** Options still loading: a spinner in place of the rows. */
  loading?: boolean;
  saved?: SavedFilters;
}

/**
 * The filter builder: rows of field / operator / value, one level of And/Or
 * groups, drag to reorder or to move rows in and out of groups, a
 * type-to-add box, and the viewer's saved filters.
 *
 * Edits land in a draft; the table only moves on Apply. Callers mount it
 * conditionally, so the draft is re-seeded from the applied filter each time.
 */
export function FilterBuilderModal<Row>({
  title = "Filters",
  fields,
  filter,
  defaults,
  onApply,
  onClose,
  loading = false,
  saved,
}: FilterBuilderModalProps<Row>) {
  const allFields = fields as FilterField<never>[];
  const byKey = useMemo(() => fieldMap(allFields), [allFields]);
  const fieldItems = useMemo(() => fieldPickerItems(allFields), [allFields]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [draft, setDraft] = useState<Draft>(() => toDraft(filter));
  const [loadedId, setLoadedId] = useState<number | undefined>(
    () => (saved && savedFilterMatching(saved.items, filter))?.id,
  );
  const [query, setQuery] = useState("");
  // Set by an Apply that found unfinished rows; from then on each row says
  // what it still needs, and clears as it's fixed.
  const [showProblems, setShowProblems] = useState(false);

  const pruned = pruneFilter(fromDraft(draft), byKey);

  // As wide as the widest row needs to sit on one line, within bounds; past
  // the cap, rows wrap instead. A row in a group sits inside the group's own
  // grip, lead and box.
  const widest = Math.max(
    ...draft.items.flatMap((item) =>
      isDraftGroup(item)
        ? item.rows.map(
            (row) => GROUP_INSET + rowWidth(row.condition, byKey.get(row.condition.field)),
          )
        : [rowWidth(item.condition, byKey.get(item.condition.field))],
    ),
    0,
  );
  const panelWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widest + PANEL_PADDING));
  const loaded = saved?.items.find((item) => item.id === loadedId);
  const suggestions = useMemo(() => suggestConditions(query, allFields), [query, allFields]);

  const setRoot = (op: Join) => setDraft((prev) => ({ ...prev, op }));

  function mapItems(fn: (items: DraftItem[]) => DraftItem[]) {
    setDraft((prev) => ({ ...prev, items: fn(prev.items) }));
  }

  function updateRow(id: string, condition: FilterCondition | null) {
    const edit = (rows: DraftRow[]) =>
      condition
        ? rows.map((row) => (row.id === id ? { ...row, condition } : row))
        : rows.filter((row) => row.id !== id);
    mapItems((items) =>
      items.flatMap((item): DraftItem[] => {
        if (isDraftGroup(item)) return [{ ...item, rows: edit(item.rows) }];
        if (item.id !== id) return [item];
        return condition ? [{ ...item, condition }] : [];
      }),
    );
  }

  function updateGroup(id: string, patch: Partial<DraftGroup> | null) {
    mapItems((items) =>
      patch
        ? items.map((item) => (item.id === id ? { ...item, ...patch } : item))
        : items.filter((item) => item.id !== id),
    );
  }

  /** Appends a row, filling a trailing blank one rather than leaving it. */
  function addCondition(condition: FilterCondition) {
    mapItems((items) => {
      const last = items[items.length - 1];
      const blank = last && !isDraftGroup(last) && last.condition.field === "";
      return [...(blank ? items.slice(0, -1) : items), { id: newId("r"), condition }];
    });
  }

  // Moves a row between the top level and a group while it's dragged, so the
  // list it's entering opens a gap where it will land.
  function onDragOver({ active: dragged, over }: DragOverEvent) {
    const id = String(dragged.id);
    if (!over || isGroupId(id)) return;
    const overId = String(over.id);
    setDraft((prev) => {
      const from = containerOf(prev.items, id);
      const to = containerOf(prev.items, overId);
      if (!from || !to || from === to) return prev;
      const source = listOf(prev.items, from);
      const row = source.find((item) => item.id === id);
      if (!row) return prev;
      // From the list as it is once the row has left, or moving out of a
      // group to the top level would copy the group, row and all.
      const items = withList(
        prev.items,
        from,
        source.filter((item) => item.id !== id),
      );
      const target = [...listOf(items, to)];
      const at = target.findIndex((item) => item.id === overId);
      target.splice(at === -1 ? target.length : at, 0, row);
      return { ...prev, items: withList(items, to, target) };
    });
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    if (!over) return;
    const id = String(dragged.id);
    setDraft((prev) => {
      let overId = String(over.id);
      // A group moves only among the top-level items, so anything inside
      // another group stands for that group.
      if (isGroupId(id)) {
        const holder = containerOf(prev.items, overId);
        if (holder && holder !== ROOT) overId = holder;
      }
      const container = containerOf(prev.items, id);
      if (!container || container !== containerOf(prev.items, overId)) return prev;
      const list = listOf(prev.items, container);
      const from = list.findIndex((item) => item.id === id);
      const to = list.findIndex((item) => item.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      return { ...prev, items: withList(prev.items, container, arrayMove(list, from, to)) };
    });
  }

  const problemOf = (row: DraftRow) =>
    conditionProblem(row.condition, byKey.get(row.condition.field));

  function apply() {
    const rows = draft.items.flatMap((item) => (isDraftGroup(item) ? item.rows : [item]));
    if (rows.some((row) => problemOf(row))) {
      setShowProblems(true);
      return;
    }
    onApply(pruned);
    onClose();
  }

  function renderRow(row: DraftRow, lead: ReactNode, position: LinePosition, inGroup = false) {
    return (
      <SortableRow
        key={row.id}
        id={row.id}
        render={(grip) => (
          <FilterConditionRow
            condition={row.condition}
            field={byKey.get(row.condition.field)}
            fieldItems={fieldItems}
            fieldByKey={byKey}
            lead={lead}
            position={position}
            variant={inGroup ? "secondary" : "primary"}
            error={showProblems ? problemOf(row) : null}
            handle={grip}
            onChange={(next) => updateRow(row.id, next)}
            onRemove={() => updateRow(row.id, null)}
          />
        )}
      />
    );
  }

  const headerActions = saved ? (
    <SavedFiltersMenu
      saved={saved}
      draft={pruned}
      loaded={loaded}
      onLoad={(item) => {
        setLoadedId(item.id);
        setDraft(toDraft(item.filter));
      }}
    />
  ) : undefined;

  return (
    <Modal
      title={title}
      onClose={onClose}
      headerActions={headerActions}
      contentStyle={{
        fontFamily: "var(--font-sans)",
        width: `${panelWidth}px`,
        maxWidth: `min(${MAX_WIDTH}px, 100%)`,
        transition: "width 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
    >
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            apply();
          }
        }}
      >
        {loaded && (
          <div
            style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "12px" }}
          >
            {loaded.name}
            {!sameFilter(loaded.filter, pruned) && " (edited)"}
          </div>
        )}

        {loading ? (
          <LoadingState context="section" />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={draft.items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {draft.items.length === 0 && (
                  <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
                    No filters. Everything is shown.
                  </div>
                )}
                {draft.items.map((item, i) => {
                  const lead = joinLead(i, draft.op, setRoot);
                  const position = linePosition(i, draft.items.length);
                  if (!isDraftGroup(item)) return renderRow(item, lead, position);
                  return (
                    <SortableGroup
                      key={item.id}
                      group={item}
                      lead={lead}
                      position={position}
                      onOp={(op) => updateGroup(item.id, { op })}
                      onRemove={() => updateGroup(item.id, null)}
                      onAdd={() => updateGroup(item.id, { rows: [...item.rows, blankRow()] })}
                      renderRow={renderRow}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
        {/* Below the rows, so its list opens over the footer rather than over
            the filters it adds to. */}
        <div style={{ marginTop: "16px" }}>
          <Combobox
            prefiltered
            blurOnSelect
            font="sans"
            placeholder="Search for a filter"
            options={suggestions}
            getId={(suggestion) => suggestion.label}
            getLabel={(suggestion) => suggestion.label}
            maxResults={Math.max(8, allFields.length)}
            emptyMessage="No matching filters."
            value={query}
            onChange={(text) => setQuery(text)}
            onSelect={(suggestion) => {
              addCondition(suggestion.condition);
              setQuery("");
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          marginTop: "20px",
          paddingTop: "16px",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => mapItems((items) => [...items, blankRow()])}
          >
            <IconPlus size={13} /> Add filter
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              mapItems((items) => [...items, { id: newId("g"), op: "or", rows: [blankRow()] }])
            }
          >
            <IconPlus size={13} /> Add group
          </Button>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {defaults && (
            <Button type="button" variant="ghost" onClick={() => setDraft(toDraft(defaults))}>
              Reset
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft({ op: "and", items: [blankRow()] });
              setLoadedId(undefined);
            }}
          >
            Clear all
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={apply} title="Apply (Ctrl+Enter)">
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
