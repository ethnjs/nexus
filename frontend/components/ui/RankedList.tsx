'use client'

import { useState } from 'react'
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Combobox } from '@/components/ui/Combobox'
import { Button } from '@/components/ui/Button'
import { IconX } from '@/components/ui/Icons'

export interface RankedListOption {
  value: string
  label: string
}

interface RankedListProps {
  options: RankedListOption[]
  ranks: number
  /** rank ("1".."ranks") -> option value. Read as a sparse map (sorted by
      numeric key, capped at `ranks`) rather than assuming every key up to
      `ranks` is present, since older answers may predate this "pick in
      order" UI. Always written back contiguous from 1. */
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
  /** Same option picked more than once across ranks — off by default (most
      "rank your top N" questions mean N *different* things), so a picked
      option normally drops out of the add-combobox's pool until removed. */
  allowDuplicates?: boolean
  locked?: boolean
  /** Shown on the add-combobox (this is the only interactive control left
      once every rank slot has a pick, so it's also where "N of ranks still
      required" surfaces once a Continue/Submit attempt flags it). */
  error?: string
}

const ROW_HEIGHT = '36px'

// One combobox to add your Nth choice (search a pool of up to dozens of
// options — event_preference can run to 40+), with the picks so far shown
// as a numbered, drag-reorderable list below. Order-of-adding IS the rank,
// so dragging is only ever needed to fix a mistake, not the primary way to
// rank — the alternative (one Dropdown per rank, all sharing the same big
// pool) means re-searching that same long list `ranks` times over instead
// of once per pick, and reordering is a drag on a touch device rather than
// a search-and-tap, both worse on mobile.
export function RankedList({ options, ranks, value, onChange, allowDuplicates = false, locked = false, error }: RankedListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [draft, setDraft] = useState('')

  const picked = Object.keys(value)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= ranks)
    .sort((a, b) => a - b)
    .map((n) => value[String(n)])

  // Locked with nothing picked is the builder's collapsed-card preview (its
  // value is always {} — there's no respondent answer yet) — falls back to
  // the options' own configured order so the card shows *something*
  // instead of an empty box, same as RadioList/CheckboxList previewing
  // every option unselected. A real answer being viewed read-only (locked
  // with picks) shows exactly those picks, not this fallback.
  const displayed = locked && picked.length === 0 ? options.slice(0, ranks).map((o) => o.value) : picked

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v
  const remainingOptions = allowDuplicates ? options : options.filter((o) => !picked.includes(o.value))

  function commit(next: string[]) {
    const nextValue: Record<string, string> = {}
    next.forEach((v, i) => { nextValue[String(i + 1)] = v })
    onChange(nextValue)
  }

  function addPick(optionValue: string) {
    if (picked.length >= ranks) return
    commit([...picked, optionValue])
  }

  function removePick(optionValue: string) {
    commit(picked.filter((v) => v !== optionValue))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = picked.indexOf(String(active.id))
    const newIndex = picked.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    commit(arrayMove(picked, oldIndex, newIndex))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={displayed} strategy={verticalListSortingStrategy}>
          {displayed.map((v, i) => (
            <RankedRow key={v} value={v} rank={i + 1} label={labelFor(v)} locked={locked} onRemove={() => removePick(v)} />
          ))}
        </SortableContext>
      </DndContext>
      {!locked && picked.length < ranks && (remainingOptions.length > 0 || error) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <RankBullet rank={picked.length + 1} />
          <div style={{ flex: 1 }}>
            <Combobox
              options={remainingOptions}
              getId={(o) => o.value}
              getLabel={(o) => o.label}
              value={draft}
              onChange={(text, matched) => {
                if (matched) {
                  addPick(matched.value)
                  setDraft('')
                } else {
                  setDraft(text)
                }
              }}
              allowFreeText={false}
              placeholder={`Add choice ${picked.length + 1} of ${ranks}`}
              maxResults={remainingOptions.length}
              error={error}
              size="md"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Fixed to ROW_HEIGHT and internally flex-centered so it lines up with just
// the input row next to it — not the midpoint of input-plus-error-message
// when that sibling's Combobox is showing a validation error below itself.
function RankBullet({ rank }: { rank: number }) {
  return (
    <span style={{
      flexShrink: 0, minWidth: '16px', height: ROW_HEIGHT,
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      fontFamily: 'var(--font-mono)', fontSize: '15px', color: 'var(--color-text-tertiary)',
    }}>
      {rank}.
    </span>
  )
}

// The bullet lives outside this row's own sortable node (see RankedList's
// map above) — it marks a fixed rank *slot*, not something that travels
// with the dragged item, so mid-drag it stays put while the pill under it
// slides to preview the new order.
function RankedRow({ value, rank, label, locked, onRemove }: {
  value: string
  rank: number
  label: string
  locked: boolean
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: value })
  // Translate, not Transform — CSS.Transform also emits the scaleX/scaleY
  // dnd-kit derives from the hovered row's rect, which squishes a dragged
  // row if rows ever differ in height (same reasoning as OptionsEditor's
  // own row list).
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      <RankBullet rank={rank} />
      <div
        ref={setNodeRef}
        {...(!locked ? attributes : {})}
        {...(!locked ? listeners : {})}
        style={{
          ...style,
          flex: 1, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          height: ROW_HEIGHT, paddingLeft: '16px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)',
          cursor: locked ? 'default' : 'grab',
          touchAction: 'none',
        }}
      >
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
          {label}
        </span>
        {!locked && (
          <Button
            type="button" variant="ghost" size="sm" iconOnly title="Remove"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
          >
            <IconX size={12} />
          </Button>
        )}
      </div>
    </div>
  )
}
