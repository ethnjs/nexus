'use client'

import { ReactNode, Ref, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconCheck } from '@/components/ui/Icons'

/**
 * The floating list every picker in the app draws: Dropdown's panel,
 * Combobox's matches, and the suggestions under an inline field
 * (EditableCombobox, the events table's location box). One component so they
 * look, position and behave the same.
 *
 * Position: fixed off the anchor's rect (so no scrolling table, popover or
 * panel can clip it), flipped above when there's more room there, and
 * re-measured on scroll and resize, since a fixed box doesn't follow its
 * anchor by itself.
 *
 * The caller owns the keys and the highlighted index (see stepActive) — the
 * focus is in its trigger or field, not in here. Rows pick on mousedown with
 * preventDefault, so picking never blurs that field first.
 */

export interface ListOption {
  key: string
  label: ReactNode
  /** A second, smaller line under the label. */
  subtitle?: ReactNode
  /** Rendered after the label, e.g. a "Removed" marker. */
  badge?: ReactNode
  disabled?: boolean
  /** Why a disabled row is disabled — shown after its label. */
  reason?: string
  /** Ticked: the current value. */
  selected?: boolean
  /** Starts a new group under this heading (Dropdown's option groups). */
  group?: string
  /** Muted text, for a row that isn't one of the options — "Use “…”". */
  muted?: boolean
}

const PANEL_MAX_HEIGHT = 260
const PANEL_GAP = 4

const SIZES = {
  sm: { padding: '5px 8px', fontSize: '13px' },
  md: { padding: '7px 10px', fontSize: '14px' },
} as const

/** The next enabled index from `active` in `dir`, or `active` if there is none. */
export function stepActive(options: readonly ListOption[], active: number, dir: 1 | -1): number {
  let next = active + dir
  while (next >= 0 && next < options.length && options[next].disabled) next += dir
  return next >= 0 && next < options.length ? next : active
}

/** The index Enter should pick: the highlighted row, else the first enabled one. */
export function enterIndex(options: readonly ListOption[], active: number): number {
  if (active >= 0 && !options[active]?.disabled) return active
  return options.findIndex((o) => !o.disabled)
}

/**
 * A free-text combobox's rows: the names matching `text`, then "Use “text”"
 * when nothing matches exactly — the way to keep a new value Enter would
 * otherwise fill in as the first match.
 */
export function suggestionRows(names: readonly string[], text: string, max = 8): { names: string[]; options: ListOption[] } {
  const needle = text.trim().toLowerCase()
  const matching = names.filter((n) => n.toLowerCase().includes(needle)).slice(0, max)
  const exact = names.some((n) => n.toLowerCase() === needle)
  const options: ListOption[] = matching.map((n) => ({ key: n, label: n }))
  if (needle && !exact) options.push({ key: '__custom__', label: `Use “${text.trim()}”`, muted: true })
  return { names: matching, options }
}

/**
 * What Enter commits in a free-text combobox: the highlighted row, else (with
 * something typed) the exact match or the first row — so a partial name fills
 * in. With nothing typed, nothing is picked and the empty text stands.
 * Returns the chosen name, or the typed text for "Use …" or no pick. Row
 * indices past `names` are the "Use …" row.
 */
export function enterChoice(names: readonly string[], active: number, text: string): string {
  const typed = text.trim()
  const index = active >= 0 ? active : typed ? 0 : -1
  if (index < 0 || index >= names.length) return typed
  const exact = names.find((n) => n.toLowerCase() === typed.toLowerCase())
  return active < 0 && exact ? exact : names[index]
}

type Pos = { left: number; width: number } & ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined })

interface OptionListProps {
  anchorRef: RefObject<HTMLElement | null>
  options: ListOption[]
  /** Highlighted index, or -1. */
  active: number
  onActiveChange: (index: number) => void
  onPick: (index: number) => void
  size?: 'sm' | 'md'
  /** At least as wide as the anchor — a field's or trigger's own list. */
  matchWidth?: boolean
  /** Shown when there are no options. Omit and an empty list renders nothing. */
  emptyMessage?: string
  /** Above the rows, outside their scroll — e.g. a search box. */
  header?: ReactNode
  /** Below the rows — e.g. Dropdown's "+ New" action. */
  footer?: ReactNode
  /** The panel element, for a caller's outside-click check. */
  panelRef?: Ref<HTMLDivElement>
  label?: string
}

export function OptionList({
  anchorRef, options, active, onActiveChange, onPick, size = 'sm', matchWidth = false,
  emptyMessage, header, footer, panelRef, label,
}: OptionListProps) {
  const [pos, setPos] = useState<Pos | null>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const sizing = SIZES[size]

  useLayoutEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - PANEL_GAP
      const above = r.top - PANEL_GAP
      setPos(below >= PANEL_MAX_HEIGHT || below >= above
        ? { top: r.bottom + PANEL_GAP, left: r.left, width: r.width }
        : { bottom: window.innerHeight - r.top + PANEL_GAP, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

  // Keep the keyboard's row on screen.
  useEffect(() => {
    if (active < 0) return
    rowsRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!pos || (options.length === 0 && !emptyMessage && !header && !footer)) return null

  return (
    <div
      ref={panelRef}
      role="listbox"
      aria-label={label}
      // Kept from Dropdown's own panel: some row-click handlers skip clicks
      // that land in a picker's list, and a press here is never an "outside"
      // press to any popover or panel this list sits in.
      data-select-panel="true"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, zIndex: 9999,
        ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
        minWidth: matchWidth ? pos.width : 160,
        padding: '4px', boxSizing: 'border-box',
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
      }}
    >
      {header}
      <div ref={rowsRef} style={{ maxHeight: `${PANEL_MAX_HEIGHT}px`, overflowY: 'auto' }}>
        {options.length === 0 && emptyMessage && (
          <p style={{ padding: sizing.padding, fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-tertiary)', margin: 0 }}>
            {emptyMessage}
          </p>
        )}
        {options.map((opt, i) => {
          const newGroup = opt.group !== undefined && opt.group !== options[i - 1]?.group
          return (
            <div key={opt.key}>
              {newGroup && (
                <>
                  {i > 0 && <div style={{ height: '1px', background: 'var(--color-border)', margin: '4px 0' }} />}
                  <div style={{
                    padding: '5px 10px 3px', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
                  }}>
                    {opt.group}
                  </div>
                </>
              )}
              <div
                role="option"
                aria-selected={!!opt.selected}
                aria-disabled={opt.disabled}
                data-idx={i}
                // Move, not enter: a list that opens under a still cursor
                // mustn't highlight that row — Enter would then pick it.
                onMouseMove={() => { if (!opt.disabled && i !== active) onActiveChange(i) }}
                onMouseDown={(e) => { e.preventDefault(); if (!opt.disabled) onPick(i) }}
                title={opt.reason}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                  padding: sizing.padding, borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-sans)', fontSize: sizing.fontSize,
                  color: opt.muted || opt.disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                  background: i === active && !opt.disabled ? 'var(--color-bg)' : 'transparent',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  opacity: opt.disabled ? 0.6 : 1,
                  userSelect: 'none', whiteSpace: 'nowrap', transition: 'background 80ms ease',
                  borderTop: opt.muted && i > 0 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {opt.label}
                    {opt.badge}
                    {opt.reason && <span style={{ fontSize: '11px', fontStyle: 'italic' }}>{opt.reason}</span>}
                  </div>
                  {opt.subtitle && (
                    <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{opt.subtitle}</div>
                  )}
                </div>
                {opt.selected && <IconCheck size={12} style={{ color: 'var(--color-accent)' }} />}
              </div>
            </div>
          )
        })}
      </div>
      {footer}
    </div>
  )
}
