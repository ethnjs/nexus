'use client'

import { useMemo, useState } from 'react'
import { TournamentEvent, TournamentDivision } from '@/lib/api'
import { eventName, eventNameWithDivision } from '@/lib/eventDisplay'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dropdown } from '@/components/ui/Dropdown'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { Checkbox } from '@/components/ui/Checkbox'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterModal, FilterOption, FilterSectionConfig, FilterState, emptyFilterState, isFilterActive } from '@/components/ui/FilterModal'
import { IconSearch, IconArrowDown, IconFilter, IconX } from '@/components/ui/Icons'
import { EditableOption } from '@/components/forms/OptionsEditor'

const PICKER_FILTER_KEYS = ['division', 'type', 'category'] as const
type PickerFilterKey = (typeof PICKER_FILTER_KEYS)[number]

const UNSET = '__unset__'
const UNCATEGORIZED = '__uncategorized__'

type SortField = 'name' | 'division' | 'day'
type SortDir = 'asc' | 'desc'
type GroupMode = 'ungrouped' | 'name' | 'category'

const SORT_FIELD_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'division', label: 'Division' },
  { value: 'day', label: 'Day' },
]

const GROUP_MODE_OPTIONS = [
  { value: 'ungrouped', label: 'Event + Division' },
  { value: 'name', label: 'Event Name' },
  { value: 'category', label: 'Category' },
]

const TYPE_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'trial', label: 'Trial' },
]

function categoryKey(e: TournamentEvent): string {
  return e.event?.category.name ?? UNSET
}

function sortValue(e: TournamentEvent, field: SortField): string | number {
  switch (field) {
    case 'name': return eventName(e).toLowerCase()
    case 'division': return e.division ?? ''
    // An event has no time of its own — its schedule is its shifts, so
    // the first day it runs is what there is to sort by.
    case 'day': return e.days[0] ?? ''
  }
}

interface PickerRow {
  key: string
  label: string
  eventIds: number[]
}

// The one place that defines "what a checked row bundles" — used both to
// render the list and, on confirm, to turn checked rows into options, so
// the two can never disagree about what a group actually contains.
function computeRows(visibleEvents: TournamentEvent[], groupMode: GroupMode): PickerRow[] {
  if (groupMode === 'ungrouped') {
    return visibleEvents.map((e) => ({
      key: `ev-${e.id}`,
      label: eventNameWithDivision(e),
      eventIds: [e.id],
    }))
  }

  if (groupMode === 'name') {
    const byName = new Map<string, TournamentEvent[]>()
    for (const e of visibleEvents) {
      const n = eventName(e)
      byName.set(n, [...(byName.get(n) ?? []), e])
    }
    return [...byName.entries()].map(([name, evs]) => {
      // Sorted (A/B/C, not insertion order) so the label is stable regardless
      // of which order events happen to appear in — only non-null divisions
      // count, so a name with just one division-less event still falls
      // through to eventNameWithDivision's bare-name case below.
      const divisions = [...new Set(evs.map((e) => e.division).filter((d): d is TournamentDivision => d != null))].sort()
      const label = divisions.length > 1 ? `${name} ${divisions.join('/')}` : eventNameWithDivision(evs[0])
      return { key: `name-${name}`, label, eventIds: evs.map((e) => e.id) }
    })
  }

  const byCat = new Map<string, TournamentEvent[]>()
  for (const e of visibleEvents) {
    const cat = e.event?.category.name ?? UNCATEGORIZED
    byCat.set(cat, [...(byCat.get(cat) ?? []), e])
  }
  return [...byCat.entries()].map(([cat, evs]) => ({
    key: `cat-${cat}`,
    label: cat === UNCATEGORIZED ? 'Uncategorized' : cat,
    eventIds: evs.map((e) => e.id),
  }))
}

interface EventOptionsPickerModalProps {
  /** EntityOptionsEditor's already-fetched entity list — no second fetch here. */
  events: TournamentEvent[]
  /** Union of every event id already used by some existing option on this
      field — filtered out of the browsable list entirely (see the file
      comment above the filtering below for why not just disabled). */
  existingEventIds: Set<number>
  onClose: () => void
  onConfirm: (newOptions: EditableOption[]) => void
}

// Bulk alternative to the per-option "+ Events" popover (EntityOptionsEditor's
// EntityPicker, left untouched) — browse the tournament's events with the
// same search/filter/sort as the Events page, then check one or more
// rows and turn each into its own option in one pass, rather than adding
// options one at a time and picking a single event into each.
export function EventOptionsPickerModal({ events, existingEventIds, onClose, onConfirm }: EventOptionsPickerModalProps) {
  const [search, setSearch] = useState('')
  // Local draft only, reset every time this modal opens — this is a "what am
  // I browsing right now" filter, not a standing view, so persisting it
  // (like EventsTab's usePersistedFilter) would silently carry over into
  // the next bulk-add session with no visible reason why.
  const [filters, setFilters] = useState<FilterState<PickerFilterKey>>(() => emptyFilterState(PICKER_FILTER_KEYS))
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [groupMode, setGroupMode] = useState<GroupMode>('ungrouped')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const browsableEvents = useMemo(
    () => events.filter((e) => !existingEventIds.has(e.id)),
    [events, existingEventIds]
  )
  const hiddenCount = events.length - browsableEvents.length

  const divisionOptions = useMemo(() => {
    const divisions = new Set(browsableEvents.map((e) => e.division).filter((d): d is TournamentDivision => d != null))
    const opts = [...divisions].sort().map((d) => ({ value: d, label: `Division ${d}` }))
    return browsableEvents.some((e) => e.division === null) ? [...opts, { value: UNSET, label: 'No division' }] : opts
  }, [browsableEvents])

  const categoryOptions = useMemo(() => {
    const names = new Set(browsableEvents.filter((e) => e.event).map((e) => e.event!.category.name))
    const opts = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }))
    return browsableEvents.some((e) => !e.event) ? [...opts, { value: UNSET, label: 'No category' }] : opts
  }, [browsableEvents])

  const visibleEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = browsableEvents.filter((e) => {
      if (q && !eventName(e).toLowerCase().includes(q)) return false
      if (filters.division.has(e.division ?? UNSET)) return false
      if (filters.type.has(e.event_type)) return false
      if (filters.category.has(categoryKey(e))) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField)
      const bv = sortValue(b, sortField)
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [browsableEvents, search, filters, sortField, sortDir])

  const rows = useMemo(() => computeRows(visibleEvents, groupMode), [visibleEvents, groupMode])

  function toggleRow(key: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Selections don't carry over across a group-mode switch — an ungrouped
  // check of just "Anatomy B" doesn't obviously imply "Anatomy B/C" under
  // name-grouping (auto-adding C the TD never reviewed), so a clean reset is
  // the safer, more predictable behavior.
  function handleGroupModeChange(mode: string) {
    setGroupMode(mode as GroupMode)
    setChecked(new Set())
  }

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.key))

  function toggleSelectAll() {
    setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.key)))
  }

  function handleConfirm() {
    const newOptions: EditableOption[] = rows
      .filter((r) => checked.has(r.key))
      .map((r) => ({ clientKey: crypto.randomUUID(), option_id: '', label: r.label, value: r.eventIds }))
    onConfirm(newOptions)
    onClose()
  }

  const sections: FilterSectionConfig<PickerFilterKey>[] = [
    { key: 'division', title: 'Division', options: divisionOptions as FilterOption[], control: 'buttons' },
    { key: 'type', title: 'Type', options: TYPE_OPTIONS, control: 'buttons' },
    { key: 'category', title: 'Category', options: categoryOptions, control: 'checkbox' },
  ]

  return (
    <Modal title="Browse events" onClose={onClose} width={700}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <div style={{ flex: '1 1 200px', minWidth: '160px' }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event name"
            icon={<IconSearch size={14} />}
            font="sans"
            size="md"
            variant="primary"
            fullWidth
          />
        </div>
        <Button type="button" variant="secondary" size="md" onClick={() => setShowFilterModal(true)}>
          <IconFilter size={16} /> Filter
        </Button>
        {isFilterActive(filters) && (
          <Button type="button" variant="ghost" size="md" onClick={() => setFilters(emptyFilterState(PICKER_FILTER_KEYS))}>
            <IconX size={16} /> Clear
          </Button>
        )}
        <Dropdown
          value={sortField}
          onChange={(v) => setSortField(v as SortField)}
          options={SORT_FIELD_OPTIONS}
          size="md"
          variant="primary"
          width={130}
        />
        <Button
          type="button" variant="secondary" size="md" iconOnly
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        >
          <IconArrowDown size={18} style={{ transition: 'transform 150ms ease', transform: sortDir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </Button>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <ButtonGroup options={GROUP_MODE_OPTIONS} value={groupMode} onChange={handleGroupModeChange} size="sm" />
      </div>

      {hiddenCount > 0 && (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>
          {hiddenCount} event{hiddenCount === 1 ? '' : 's'} already added {hiddenCount === 1 ? 'is' : 'are'} hidden.
        </p>
      )}

      <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
        {rows.length === 0 ? (
          <EmptyState title="No matching events" description="Try adjusting your search or filters." />
        ) : (
          <>
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                padding: '9px 12px', borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
              }}
            >
              <Checkbox checked={allChecked} onChange={toggleSelectAll} />
              <span style={{
                fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)',
              }}>
                {allChecked ? 'Deselect all' : 'Select all'}
              </span>
            </label>
            {rows.map((row, i) => (
              <label
                key={row.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                  padding: '9px 12px',
                  borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--color-border)',
                }}
              >
                <Checkbox checked={checked.has(row.key)} onChange={() => toggleRow(row.key)} />
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                  {row.label}
                </span>
              </label>
            ))}
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" disabled={checked.size === 0} onClick={handleConfirm}>
          Add {checked.size} option{checked.size === 1 ? '' : 's'}
        </Button>
      </div>

      {showFilterModal && (
        <FilterModal
          title="Filter events"
          sections={sections}
          filters={filters}
          onApply={setFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}
    </Modal>
  )
}
