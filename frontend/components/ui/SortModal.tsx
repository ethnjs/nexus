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

  const used = new Set(draft.map((rule) => rule.field))
  const available = fields.filter((field) => !used.has(field.value))

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
    <Modal title={title} onClose={onClose} width={520}>
      <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
        {draft.length === 0 ? (
          <EmptyState size="sm" title="No sort" description="Rows keep the order they arrive in." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={draft.map((rule) => rule.field)} strategy={verticalListSortingStrategy}>
              {draft.map((rule, index) => {
                const field = fields.find((f) => f.value === rule.field)
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Dropdown
                            size="sm"
                            fullWidth
                            value={rule.field}
                            options={[
                              { value: rule.field, label: field?.label ?? rule.field },
                              ...available.map((f) => ({ value: f.value, label: f.label })),
                            ]}
                            onChange={(next) => patch(rule.field, { field: next })}
                          />
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
            onChange={(field) => setDraft((cur) => [...cur, { field, direction: 'asc' }])}
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
