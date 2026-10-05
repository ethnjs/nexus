'use client'

import { useState } from 'react'
import {
  DndContext, DragEndEvent, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Button } from '@/components/ui/Button'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { Dropdown } from '@/components/ui/Dropdown'
import { PillMenu } from '@/components/ui/PillMenu'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconGripVertical, IconX } from '@/components/ui/Icons'
import { Modal } from '@/components/ui/Modal'
import type { SortDirection, SortRule } from '@/lib/sorting'

export interface SortFieldOption {
  value: string
  label: string
  /** What the two directions mean for this field — "A → Z" reads better than
   *  "Ascending" on a name, "Most short first" than "Descending" on a count. */
  ascLabel?: string
  descLabel?: string
  /** Makes this a category ("Track status") narrowed by a pill per level
   *  ("Day 1"), instead of one field per track in the picker. The rule's
   *  field is then `value:pick:pick` — "event_pref:3:47". */
  pills?: SortPill[]
}

export interface SortPillOption { value: string; label: string }

export interface SortPill {
  /** What the pill picks — "Track", "Event". Shown until something is picked. */
  label: string
  /** This pill's choices, given the picks to its left. */
  options: (picked: string[]) => SortPillOption[]
}

// Past this many, a pill's menu gets a search box.
const SEARCHABLE_ABOVE = 8

/** The option a stored field belongs to: itself, or the category it narrows. */
function optionFor(fields: SortFieldOption[], field: string): SortFieldOption | undefined {
  return fields.find((f) => f.value === field) ?? fields.find((f) => f.pills && field.startsWith(`${f.value}:`))
}

function picksOf(category: SortFieldOption, field: string): string[] {
  return field.slice(category.value.length + 1).split(':')
}

function keyOf(category: SortFieldOption, picks: string[]): string {
  return [category.value, ...picks].join(':')
}

/** The first complete set of picks starting with `prefix` that no other rule
 *  sorts by yet, or null — a category with nothing left to pick is full. */
function firstFree(category: SortFieldOption, prefix: string[], taken: Set<string>): string[] | null {
  const pills = category.pills ?? []
  if (prefix.length === pills.length) return taken.has(keyOf(category, prefix)) ? null : prefix
  for (const option of pills[prefix.length].options(prefix)) {
    const found = firstFree(category, [...prefix, option.value], taken)
    if (found) return found
  }
  return null
}

/** A field ready to sort by: a plain one as-is, a category filled in with
 *  its first unused picks. null when there's nothing free left. */
function completeField(field: SortFieldOption, taken: Set<string>): string | null {
  if (!field.pills) return taken.has(field.value) ? null : field.value
  const picks = firstFree(field, [], taken)
  return picks ? keyOf(field, picks) : null
}

interface SortModalProps {
  title?: string
  fields: SortFieldOption[]
  rules: SortRule[]
  /** The surface's own default chain. Reset returns here. */
  defaults?: SortRule[]
  /** What the rows fall back to once the chain runs out, named for the
   *  footnote — the chain never sorts alone (see buildComparator). */
  tiebreakLabel?: string
  onApply: (rules: SortRule[]) => void
  onClose: () => void
}

function DIRECTION_OPTIONS(field: SortFieldOption | undefined) {
  return [
    { value: 'asc', label: field?.ascLabel ?? 'Ascending' },
    { value: 'desc', label: field?.descLabel ?? 'Descending' },
  ]
}

function SortRow({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 8px', marginBottom: '8px',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)',
      }}
    >
      {children(
        <span
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-tertiary)', cursor: 'grab' }}
        >
          <IconGripVertical size={14} />
        </span>,
      )}
    </div>
  )
}

/**
 * The sort chain editor: an ordered list of field + direction rows.
 *
 * Order is precedence — the first row sorts, the ones under it break its
 * ties — so the list is draggable rather than a set of controls whose
 * relationship you have to infer. A field already in the chain drops out of
 * the add menu: sorting by the same key twice can only ever be a mistake,
 * since the second copy sees only rows the first one tied.
 */
export function SortModal({
  title = 'Sort', fields, rules, defaults, tiebreakLabel, onApply, onClose,
}: SortModalProps) {
  const [draft, setDraft] = useState<SortRule[]>(rules)

  // Same split as RankedList's: a 4px pointer threshold is indistinguishable
  // from the start of a scroll on a phone, so touch waits for a press.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  // Pills sit on the picker's line, so a surface that has them gets the room;
  // a plain one (events, shifts) keeps the narrow modal.
  const hasPills = fields.some((field) => field.pills)

  const used = new Set(draft.map((rule) => rule.field))
  // A category stays offered while any of its picks is free.
  const available = fields.filter((field) => completeField(field, used) !== null)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = draft.findIndex((rule) => rule.field === active.id)
    const to = draft.findIndex((rule) => rule.field === over.id)
    if (from < 0 || to < 0) return
    setDraft(arrayMove(draft, from, to))
  }

  function patch(field: string, changes: Partial<SortRule>) {
    setDraft((cur) => cur.map((rule) => (rule.field === field ? { ...rule, ...changes } : rule)))
  }

  return (
    <Modal title={title} onClose={onClose} width={hasPills ? 880 : 520}>
      <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
        {draft.length === 0 ? (
          <EmptyState size="sm" title="No sort" description="Rows keep the order they arrive in." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={draft.map((rule) => rule.field)} strategy={verticalListSortingStrategy}>
              {draft.map((rule, index) => {
                const field = optionFor(fields, rule.field)
                // Everything the other rules hold — what this one can't switch to.
                const others = new Set(draft.filter((r) => r.field !== rule.field).map((r) => r.field))
                const picks = field?.pills ? picksOf(field, rule.field) : []
                return (
                  <SortRow key={rule.field} id={rule.field}>
                    {(handle) => (
                      <>
                        {handle}
                        {/* "then by" rather than a number: the relationship
                            between the rows is the thing to say, and it is
                            the same sentence you would say out loud. */}
                        <span style={{
                          width: '52px', flexShrink: 0,
                          fontFamily: 'var(--font-sans)', fontSize: '11px',
                          color: 'var(--color-text-tertiary)',
                        }}>
                          {index === 0 ? 'Sort by' : 'then by'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Fixed width with pills about, so every row's pills
                              start at the same x and line up down the chain. */}
                          <div style={hasPills ? { width: '170px', flexShrink: 0 } : { flex: 1, minWidth: 0 }}>
                            <Dropdown
                              size="sm"
                              fullWidth
                              value={field?.value ?? rule.field}
                              options={[
                                { value: field?.value ?? rule.field, label: field?.label ?? rule.field },
                                ...available
                                  .filter((f) => f.value !== field?.value)
                                  .map((f) => ({ value: f.value, label: f.label })),
                              ]}
                              onChange={(next) => {
                                const target = fields.find((f) => f.value === next)
                                const key = target && completeField(target, others)
                                if (key) patch(rule.field, { field: key })
                              }}
                            />
                          </div>
                          {field?.pills && (
                            // Wraps only when the window is narrower than the modal.
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {field.pills.map((pill, i) => {
                                const options = pill.options(picks.slice(0, i))
                                // A pick keeps the picks to its left and refills
                                // the ones to its right with the first free set.
                                const extend = (value: string) => firstFree(field, [...picks.slice(0, i), value], others)
                                return (
                                  <PillMenu
                                    key={pill.label}
                                    label={options.find((o) => o.value === picks[i])?.label ?? pill.label}
                                    size="md"
                                    items={options}
                                    getKey={(o) => o.value}
                                    renderLabel={(o) => o.label}
                                    getSearchText={(o) => o.label}
                                    searchable={options.length > SEARCHABLE_ABOVE}
                                    isDisabled={(o) => extend(o.value) === null}
                                    disabledReason={() => 'Already in the sort'}
                                    onSelect={(o) => {
                                      const next = extend(o.value)
                                      if (next) patch(rule.field, { field: keyOf(field, next) })
                                    }}
                                    width={240}
                                    align="left"
                                  />
                                )
                              })}
                            </div>
                          )}
                        </div>
                        <ButtonGroup
                          size="sm"
                          options={DIRECTION_OPTIONS(field)}
                          value={rule.direction}
                          onChange={(next) => patch(rule.field, { direction: next as SortDirection })}
                        />
                        <Button
                          type="button" variant="ghost" size="sm" iconOnly
                          title="Remove" aria-label={`Remove sort by ${field?.label ?? rule.field}`}
                          onClick={() => setDraft((cur) => cur.filter((r) => r.field !== rule.field))}
                        >
                          <IconX size={13} />
                        </Button>
                      </>
                    )}
                  </SortRow>
                )
              })}
            </SortableContext>
          </DndContext>
        )}

        {available.length > 0 && (
          <Dropdown
            size="sm"
            variant="transparent"
            fitContent
            value=""
            placeholder="Add a sort"
            options={available.map((f) => ({ value: f.value, label: f.label }))}
            onChange={(value) => {
              const target = fields.find((f) => f.value === value)
              const key = target && completeField(target, used)
              if (key) setDraft((cur) => [...cur, { field: key, direction: 'asc' }])
            }}
          />
        )}

        {tiebreakLabel && (
          // Stated, not offered: the chain always ends here, and a viewer who
          // cannot see that wonders why two identical rows are in the order
          // they are.
          <p style={{
            marginTop: '12px',
            fontFamily: 'var(--font-sans)', fontSize: '11px', color: 'var(--color-text-tertiary)',
          }}>
            Ties fall back to {tiebreakLabel}.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '16px' }}>
        <Button type="button" variant="ghost" onClick={() => setDraft(defaults ?? [])}>
          {defaults && defaults.length > 0 ? 'Reset' : 'Clear all'}
        </Button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { onApply(draft); onClose() }}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  )
}
