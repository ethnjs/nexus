"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, closestCenter,
  useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { formsApi, tournamentsApi, tournamentShiftsApi, Form, Tournament, TournamentShift } from "@/lib/api";
import { enumerateDates } from "@/lib/date";
import { useFormValidation } from "@/lib/forms/useFormValidation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconForms, IconPlus } from "@/components/ui/Icons";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { FieldCard, FieldCardDragPreview } from "@/components/forms/FieldCard";
import { FieldToolbar } from "@/components/forms/FieldToolbar";
import { EditableOption } from "@/components/forms/OptionsEditor";
import {
  EditableField, withOptionClientKeys, newField, toFieldInput, deriveBranchingEnabled, deriveCustomValuesEnabled,
} from "@/lib/forms/editableField";
import { DISPLAY_STYLE_TYPES } from "@/lib/forms/fieldTypes";

// How long a scroll-into-view keeps following a card that's still growing
// (see scrollCardIntoView) — long enough to cover a shifts/events fetch on
// a slow connection, short enough that it can't surprise you later.
const SETTLE_MS = 2000;

// Strict accordion — expanding a card collapses whatever was previously
// expanded; only one card is ever in edit mode at a time, and (unlike a
// dismissible panel) it's never *zero* while there's at least one field —
// there's always something open to edit, clicking outside doesn't dismiss
// it, and every mutation that could otherwise drop the count to zero
// (delete, save, discard) picks a fallback card to keep open. Field edits
// are staged in local state, diffed against a JSON.stringify'd baseline
// snapshot of what was last loaded/saved — FloatingSaveBar shows whenever
// that diff is non-empty, and Save PUTs the whole field list in one batch
// (see the Edit Lifecycle notes on formsApi.putFields).
export function FieldList({ form }: { form: Form }) {
  const [fields, setFields] = useState<EditableField[]>(() =>
    form.fields
      .filter((f) => !f.is_archived)
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        ...withOptionClientKeys(f), clientKey: String(f.id), showDescription: !!f.description,
        branchingEnabled: deriveBranchingEnabled(f), customValuesEnabled: deriveCustomValuesEnabled(f),
      }))
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(() => fields[0]?.clientKey ?? null);
  const [usedFieldKeys, setUsedFieldKeys] = useState<string[]>([]);
  // The full tournament — this standalone /forms/ route sits outside the
  // dashboard's TournamentProvider, so there's no shared context to read it
  // from; fetched here and passed down as one object (id, start/end date,
  // is_multi_day, ...) rather than threading the individual fields each
  // consumer happens to need through every layer between here and them.
  // null until loaded (or permanently, on a chapter-owned form with no
  // tournament). tournamentDates below is just its derived day list, for
  // PresetPopover's date pickers.
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const tournamentDates = tournament ? enumerateDates(tournament.start_date, tournament.end_date) : [];
  // Fetched once here (not per-card) so every collapsed availability-preset
  // card's preview can show its option's time range without each one
  // re-fetching the same list — EntityOptionsEditor fetches its own copy
  // too, but only while a field is actually expanded/being edited.
  const [shifts, setShifts] = useState<TournamentShift[] | null>(null);
  useEffect(() => {
    if (form.tournament_id == null) return;
    tournamentShiftsApi.list(form.tournament_id).then(setShifts).catch(() => {});
  }, [form.tournament_id]);
  // Set by add/duplicate so the effect below can scroll the new card into view
  // once its expand animation has settled at its real height.
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const validation = useFormValidation();
  const [saving, setSaving] = useState(false);
  // Reported live by FloatingSaveBar (its own measured height, which grows
  // when a validation/save error wraps to a second line) — applied as
  // bottom padding so the bar never covers the last question(s) in the list.
  // Mirrored into a ref because FloatingSaveBar reports from a *layout*
  // effect, which runs before this component's pending passive effects: the
  // scroll below would otherwise read a stale 0 on the very render where the
  // bar appears (i.e. exactly when it's about to cover something).
  const [saveBarHeight, setSaveBarHeight] = useState(0);
  const saveBarHeightRef = useRef(0);
  function handleSaveBarHeight(px: number) {
    saveBarHeightRef.current = px;
    setSaveBarHeight(px);
  }
  // Bumped on every *failed* Save — FieldKeyPopover uses this as an
  // edge-trigger to auto-open when Save surfaces a key error on its field,
  // since the errors array alone can't tell "just failed again" from "this
  // stale error is still sitting there."
  const [saveAttempt, setSaveAttempt] = useState(0);
  // Baseline snapshot to diff against — set once on mount, then again after
  // every successful Save (the server's response, not what was submitted,
  // becomes the new baseline: it's the source of truth for server-assigned
  // ids/option_ids).
  const baselineRef = useRef<string | null>(null);
  if (baselineRef.current === null) baselineRef.current = JSON.stringify(fields);
  const isDirty = JSON.stringify(fields) !== baselineRef.current;

  const expandedField = fields.find((f) => f.clientKey === expandedKey);
  // Re-measure when cards are added/removed/reordered — but not on every
  // keystroke, which `fields` itself as a dep would do (new array each edit).
  const fieldOrderKey = fields.map((f) => f.clientKey).join(",");

  // Track the expanded card's offset/height so the toolbar follows it. A
  // ResizeObserver (not a one-shot measure) keeps the two in lockstep;
  // observing the list too catches offsetTop shifts when a sibling above it
  // expands/collapses or content changes height.
  useLayoutEffect(() => {
    const list = listRef.current;
    const box = toolbarRef.current;
    if (!expandedKey || !list || !box) return;
    const card = list.querySelector<HTMLElement>(`[data-field-card="${expandedKey}"]`);
    if (!card) return;
    const measure = () => {
      box.style.top = `${card.offsetTop}px`;
      box.style.height = `${card.offsetHeight}px`;
      box.style.visibility = "visible";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(list);
    return () => observer.disconnect();
  }, [expandedKey, fieldOrderKey]);

  // Tears down the in-flight settle watch below. Held in a ref so a new
  // scroll request (or unmount) cancels the previous card's watch.
  const settleRef = useRef<(() => void) | null>(null);
  useEffect(() => () => settleRef.current?.(), []);

  // Bring a card fully into the clear — below the sticky topbar, above the
  // save bar's resting footprint (0 while it's hidden). No-ops when the card
  // already fits, so it never yanks the page out from under a scroll the
  // user just made themselves.
  //
  // Then keeps re-applying while the card is still settling: the entity-backed
  // presets (availability, event_preference) fetch their shifts/events on
  // expand, so those cards reach their real height a beat *after* we first
  // measure — one shot would scroll to a height that's about to change and
  // land short. The watch ends at the first sign of the user scrolling
  // themselves (our own smooth scroll doesn't fire these events, so it can't
  // cancel itself), or after SETTLE_MS if the fetch never resolves.
  function scrollCardIntoView(clientKey: string) {
    settleRef.current?.();
    const card = listRef.current?.querySelector<HTMLElement>(`[data-field-card="${clientKey}"]`);
    if (!card) return;

    const apply = () => {
      const rect = card.getBoundingClientRect();
      const safeTop = TOPBAR_HEIGHT + 12;
      const safeBottom = window.innerHeight - saveBarHeightRef.current;
      if (rect.top >= safeTop && rect.bottom <= safeBottom) return;
      // Top-align when the card is too tall to fit whole (or is above the
      // fold) — its label/type controls are up top and matter more than its
      // tail. This is also what a card keeps doing as async options stream
      // in past the viewport height, instead of chasing its growing bottom.
      const delta = rect.top < safeTop || rect.height > safeBottom - safeTop
        ? rect.top - safeTop - 8
        : rect.bottom - safeBottom + 8;
      window.scrollTo({ top: window.scrollY + delta, behavior: "smooth" });
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(card);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const e of ["wheel", "touchmove", "keydown"]) window.removeEventListener(e, stop);
      settleRef.current = null;
    };
    const timer = setTimeout(stop, SETTLE_MS);
    for (const e of ["wheel", "touchmove", "keydown"]) window.addEventListener(e, stop, { passive: true });
    settleRef.current = stop;
  }

  useEffect(() => {
    if (!pendingScrollKey) return;
    setPendingScrollKey(null);
    scrollCardIntoView(pendingScrollKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScrollKey]);

  // The bar slides in over whatever happens to sit at the bottom of the
  // viewport, which on the edit that *made* the form dirty is usually the
  // card being edited. Re-runs when the bar appears/grows or the open card
  // changes; the no-op guard above keeps it quiet the rest of the time.
  useEffect(() => {
    if (!expandedKey || saveBarHeight === 0) return;
    scrollCardIntoView(expandedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveBarHeight, expandedKey]);

  // Fetched once per form-editing session (not per field card) — every
  // field's FieldKeyPopover shares this list to flag already-used keys.
  useEffect(() => {
    if (form.tournament_id == null) return;
    formsApi.listFieldKeysForTournament(form.tournament_id).then(setUsedFieldKeys).catch(() => {});
  }, [form.tournament_id]);

  // Loaded eagerly on mount (not deferred until something that needs it —
  // PresetPopover's date pickers, EntityOptionsEditor — first renders) and
  // re-loaded every time a preset popover opens (see FieldToolbar's
  // onOpenPresets below), so a tab left open a while doesn't show a
  // page-load-stale tournament if its dates changed since.
  function loadTournament() {
    if (form.tournament_id == null) return;
    tournamentsApi.get(form.tournament_id).then(setTournament).catch(() => {});
  }
  useEffect(loadTournament, [form.tournament_id]);

  function updateField(clientKey: string, updates: Partial<EditableField>) {
    setFields((prev) => prev.map((f) => (f.clientKey === clientKey ? { ...f, ...updates } : f)));
  }

  function addField(afterClientKey?: string) {
    const insertIndex = afterClientKey ? fields.findIndex((f) => f.clientKey === afterClientKey) + 1 : fields.length;
    const field = newField(insertIndex + 1);
    setFields((prev) => {
      const next = [...prev];
      next.splice(insertIndex, 0, field);
      return next;
    });
    setExpandedKey(field.clientKey);
    setPendingScrollKey(field.clientKey);
  }

  // Cleared field_key on the copy — a reserved key (availability, ...) can
  // only exist once per tournament, and a freeform key the TD chose
  // deliberately shouldn't silently duplicate either.
  function duplicateField(clientKey: string) {
    const source = fields.find((f) => f.clientKey === clientKey);
    if (!source) return;
    const insertIndex = fields.findIndex((f) => f.clientKey === clientKey) + 1;
    const copy: EditableField = {
      ...source,
      clientKey: crypto.randomUUID(),
      id: null,
      field_key: "",
      config: source.config?.options
        ? { ...source.config, options: (source.config.options as EditableOption[]).map((o) => ({ ...o, clientKey: crypto.randomUUID(), option_id: "" })) }
        : source.config,
    };
    setFields((prev) => {
      const next = [...prev];
      next.splice(insertIndex, 0, copy);
      return next;
    });
    setExpandedKey(copy.clientKey);
    setPendingScrollKey(copy.clientKey);
  }

  // Deleting the expanded card would otherwise drop the open count to zero —
  // fall back to whatever's now at its old index (its old neighbor below),
  // or the one above if it was last.
  function deleteField(clientKey: string) {
    const deletedIndex = fields.findIndex((f) => f.clientKey === clientKey);
    const next = fields.filter((f) => f.clientKey !== clientKey);
    setFields(next);
    if (expandedKey === clientKey) {
      const fallback = next[deletedIndex] ?? next[deletedIndex - 1];
      setExpandedKey(fallback ? fallback.clientKey : null);
    }
  }

  async function handleSave() {
    const issues = validation.validate(fields);
    if (issues.length > 0) {
      // Expand *and* scroll to the first offending card — "fix the
      // highlighted questions below" was ambiguous (the actual error could
      // be above the user's current scroll position), so this makes the
      // message true by construction instead of rewording around it.
      setExpandedKey(issues[0].clientKey);
      setPendingScrollKey(issues[0].clientKey);
      setSaveAttempt((n) => n + 1);
      return;
    }
    setSaving(true);
    try {
      // A not-yet-saved field's clientKey is a client UUID that the server
      // response replaces with String(new id) — track position instead of
      // identity so the same card stays open across that swap.
      const expandedIndex = fields.findIndex((f) => f.clientKey === expandedKey);
      const updated = await formsApi.putFields(form.id, fields.map(toFieldInput));
      const next = updated
        .filter((f) => !f.is_archived)
        .sort((a, b) => a.order - b.order)
        .map((f) => ({
          ...withOptionClientKeys(f), clientKey: String(f.id), showDescription: !!f.description,
          branchingEnabled: deriveBranchingEnabled(f), customValuesEnabled: deriveCustomValuesEnabled(f),
        }));
      setFields(next);
      setExpandedKey(next[expandedIndex]?.clientKey ?? next[0]?.clientKey ?? null);
      baselineRef.current = JSON.stringify(next);
      validation.clearAll();
    } catch (err) {
      validation.handle422(err);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    const restored: EditableField[] = baselineRef.current ? JSON.parse(baselineRef.current) : [];
    setFields(restored);
    // Keep the same card open if it survived the revert. If it didn't (you
    // added a question, then discarded), walk *up* from where it sat to the
    // nearest survivor rather than jumping to the top of the list — the
    // question above the one you just dropped is where you were working.
    const droppedIndex = fields.findIndex((f) => f.clientKey === expandedKey);
    const above = droppedIndex < 0 ? [] : fields.slice(0, droppedIndex).reverse();
    const key = restored.some((f) => f.clientKey === expandedKey)
      ? expandedKey
      : above.find((f) => restored.some((r) => r.clientKey === f.clientKey))?.clientKey
        ?? restored[0]?.clientKey
        ?? null;
    setExpandedKey(key);
    if (key) setPendingScrollKey(key);
    validation.clearAll();
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  // The card currently under the cursor — drives the DragOverlay's compressed
  // preview. The real card stays mounted (invisible) so its slot keeps the
  // layout space dnd-kit measured at drag start.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // Captured at drag start: by drag end, deciding whether to auto-expand the
  // dropped card needs its *pre-drag* state, which setExpandedKey below would
  // have already overwritten.
  const draggedWasExpandedRef = useRef(false);
  const draggingField = fields.find((f) => f.clientKey === draggingKey);

  function handleDragStart(e: DragStartEvent) {
    const key = String(e.active.id);
    setDraggingKey(key);
    draggedWasExpandedRef.current = expandedKey === key;
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setDraggingKey(null);
    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex((f) => f.clientKey === active.id);
      const newIndex = fields.findIndex((f) => f.clientKey === over.id);
      if (oldIndex !== -1 && newIndex !== -1) setFields((prev) => arrayMove(prev, oldIndex, newIndex));
    }
    // Same accordion rule as add/duplicate — the card you just acted on
    // becomes the open one. Already-expanded cards need no action (moving
    // them can't drop the open count to zero).
    if (!draggedWasExpandedRef.current) setExpandedKey(String(active.id));
  }

  return (
    <div
      ref={listRef}
      style={{
        position: "relative", display: "flex", flexDirection: "column", gap: "12px",
        // Applied instantly in both directions, deliberately: this padding is
        // the scroll room scrollCardIntoView depends on, and the browser
        // clamps scrollTo against the document height *at call time*.
        // Animating the grow would clamp the scroll short (card stays under
        // the bar); animating the shrink would let the document keep
        // collapsing underneath a scroll already in flight. The cost is that
        // the page's bottom edge snaps rather than glides when the bar
        // appears/leaves, which is only visible if you're scrolled to the end.
        paddingBottom: `${saveBarHeight}px`,
      }}
    >
      {fields.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconForms size={28} />}
            title="No fields yet"
            description="Add a field to start building this form."
            action={
              <Button type="button" variant="primary" size="sm" onClick={() => addField()}>
                <IconPlus size={14} /> Add field
              </Button>
            }
          />
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingKey(null)}
        >
          <SortableContext items={fields.map((f) => f.clientKey)} strategy={verticalListSortingStrategy}>
            {fields.map((field) => (
              <FieldCard
                key={field.clientKey}
                field={field}
                expanded={expandedKey === field.clientKey}
                onExpand={() => setExpandedKey(field.clientKey)}
                onFieldChange={(updates) => updateField(field.clientKey, updates)}
                onDuplicate={() => duplicateField(field.clientKey)}
                onDelete={() => deleteField(field.clientKey)}
                tournament={tournament}
                shifts={shifts}
                allFields={fields}
                errors={validation.errorsFor(field.clientKey)}
              />
            ))}
          </SortableContext>
          {/* dropAnimation off: the default animates the overlay into the
              drop slot's rect, which would stretch this compact preview back
              out to the full card height on release. */}
          <DragOverlay dropAnimation={null}>
            {draggingField ? <FieldCardDragPreview field={draggingField} /> : null}
          </DragOverlay>
        </DndContext>
      )}
      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={validation.hasErrors ? `${validation.validationErrors.length} issue${validation.validationErrors.length !== 1 ? "s" : ""} — fix the highlighted question${validation.validationErrors.length !== 1 ? "s" : ""}.` : validation.saveError || undefined}
        onSave={handleSave}
        onCancel={handleDiscard}
        onHeightChange={handleSaveBarHeight}
        stayWithin={`/forms/${form.id}`}
      />
      {expandedField && (
        <FieldToolbar
          // Remounts (resetting FieldToolbar's own activePopover state, so
          // a key/preset popover left open doesn't silently follow you to
          // whatever field you switch to next) whenever the expanded field
          // changes.
          key={expandedField.clientKey}
          boxRef={toolbarRef}
          field={expandedField}
          onFieldChange={(updates) => updateField(expandedField.clientKey, updates)}
          usedFieldKeys={usedFieldKeys}
          allFields={fields}
          tournamentDates={tournamentDates}
          onOpenPresets={loadTournament}
          errors={validation.errorsFor(expandedField.clientKey)}
          saveAttempt={saveAttempt}
          showDescription={expandedField.showDescription}
          onAddFieldBelow={() => addField(expandedField.clientKey)}
          onToggleDescription={() =>
            updateField(expandedField.clientKey, { showDescription: !expandedField.showDescription })
          }
          displayStyle={DISPLAY_STYLE_TYPES.includes(expandedField.question_type) ? expandedField.config?.display_style ?? "list" : undefined}
          onToggleDisplayStyle={() =>
            updateField(expandedField.clientKey, {
              config: { ...expandedField.config, display_style: expandedField.config?.display_style === "buttons" ? "list" : "buttons" },
            })
          }
        />
      )}
    </div>
  );
}
