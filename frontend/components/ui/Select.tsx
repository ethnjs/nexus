'use client'

import {
  useState,
  useRef,
  useEffect,
  useId,
  KeyboardEvent,
} from 'react'
import { IconChevronDown } from './Icons'

// ─── Types ────────────────────────────────────────────────────────────────────

// TODO(decision): SelectOption.value is string-only. Accepting string | number would require
// changing SelectProps.value and onChange signature, propagating to all call sites.
// Current workaround: convert numbers to string at the call site with String().
export interface SelectOption {
  value:     string
  label:     string
  disabled?: boolean
}

export interface SelectOptionGroup {
  group:   string
  options: SelectOption[]
}

export type SelectItem = SelectOption | SelectOptionGroup

function isGroup(item: SelectItem): item is SelectOptionGroup {
  return 'group' in item
}

function flatOptions(items: SelectItem[]): SelectOption[] {
  return items.flatMap((item) => (isGroup(item) ? item.options : [item]))
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SelectProps {
  value:        string
  onChange:     (value: string) => void
  options:      SelectItem[]
  label?:       string
  placeholder?: string
  error?:       string
  locked?:      boolean
  fullWidth?:   boolean
  size?:        'sm' | 'md'
  /** Minimum width of the trigger in px. Useful for sm selects that need a fixed floor. */
  minWidth?:    number
  // primary -- var(--color-bg); secondary (default) -- var(--color-surface).
  variant?:     'primary' | 'secondary'
  id?:          string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PANEL_MAX_HEIGHT = 260
const PANEL_GAP        = 4   // px between trigger edge and panel

// Heights match Button/Input's scale — same size name, same height everywhere.
const SIZE_MAP: Record<'sm' | 'md', { height: number; triggerFontSize: string; optionPadding: string; optionFontSize: string }> = {
  sm: { height: 28, triggerFontSize: '11px', optionPadding: '5px 8px',  optionFontSize: '11px' },
  md: { height: 36, triggerFontSize: '14px', optionPadding: '7px 10px', optionFontSize: '13px' },
}

const BACKGROUND_MAP: Record<'primary' | 'secondary', string> = {
  primary:   'var(--color-bg)',
  secondary: 'var(--color-surface)',
}

// ─── Panel position type ──────────────────────────────────────────────────────

type PanelPos =
  | { above: false; top: number;    left: number; width: number }
  | { above: true;  bottom: number; left: number; width: number }

// ─── Component ────────────────────────────────────────────────────────────────

export function Select({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select...',
  error,
  locked = false,
  fullWidth = false,
  size = 'md',
  minWidth,
  variant = 'secondary',
  id,
}: SelectProps) {
  const generatedId               = useId()
  const triggerId                 = id ?? generatedId
  const [open, setOpen]           = useState(false)
  const [focused, setFocused]     = useState(false)
  const [activeIdx, setActiveIdx] = useState<number>(-1)
  const [panelPos, setPanelPos]   = useState<PanelPos | null>(null)
  const containerRef              = useRef<HTMLDivElement>(null)
  const triggerRef                = useRef<HTMLButtonElement>(null)
  const listRef                   = useRef<HTMLDivElement>(null)

  const sizing    = SIZE_MAP[size]
  const triggerBg = BACKGROUND_MAP[variant]

  const flat         = flatOptions(options)
  const selected     = flat.find((o) => o.value === value)
  const displayLabel = selected?.label ?? placeholder

  // ── Update panel position — flip upward when not enough space below ───────

  function updatePanelPos() {
    if (!triggerRef.current) return
    const r          = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - PANEL_GAP
    const spaceAbove = r.top - PANEL_GAP

    if (spaceBelow >= PANEL_MAX_HEIGHT || spaceBelow >= spaceAbove) {
      // Enough room below, or more room below than above — open downward
      setPanelPos({ above: false, top: r.bottom + PANEL_GAP, left: r.left, width: r.width })
    } else {
      // More room above — flip upward, anchor bottom of panel to top of trigger
      setPanelPos({ above: true, bottom: window.innerHeight - r.top + PANEL_GAP, left: r.left, width: r.width })
    }
  }

  useEffect(() => {
    if (!open) { setPanelPos(null); return }
    updatePanelPos()
    window.addEventListener('scroll', updatePanelPos, true)
    window.addEventListener('resize', updatePanelPos)
    return () => {
      window.removeEventListener('scroll', updatePanelPos, true)
      window.removeEventListener('resize', updatePanelPos)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Scroll active option into view ────────────────────────────────────────

  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  // ── Set active index to current value when opening ────────────────────────

  useEffect(() => {
    if (open) {
      const idx = flat.findIndex((o) => o.value === value)
      setActiveIdx(idx >= 0 ? idx : 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Keyboard handling ─────────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (locked) return
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (open) {
          const opt = flat[activeIdx]
          if (opt && !opt.disabled) { onChange(opt.value); setOpen(false) }
        } else {
          setOpen(true)
        }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!open) { setOpen(true); break }
        setActiveIdx((prev) => {
          let next = prev + 1
          while (next < flat.length && flat[next]?.disabled) next++
          return next < flat.length ? next : prev
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) { setOpen(true); break }
        setActiveIdx((prev) => {
          let next = prev - 1
          while (next >= 0 && flat[next]?.disabled) next--
          return next >= 0 ? next : prev
        })
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // TODO: color-border-strong is too similar to color-border — focused state is barely visible
  const borderColor = error ? 'var(--color-danger)' : focused && !open
    ? 'var(--color-border-strong)'
    : 'var(--color-border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: fullWidth ? '100%' : undefined }}>
      {label && (
        <label
          htmlFor={triggerId}
          style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 400, color: 'var(--color-text-secondary)' }}
        >
          {label}
        </label>
      )}

      <div ref={containerRef} style={{ position: 'relative', width: fullWidth ? '100%' : undefined }}>
        {/* Trigger */}
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-select-trigger="true"
          onClick={(e) => { e.stopPropagation(); if (!locked) setOpen((v) => !v) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            gap:            '8px',
            width:          fullWidth ? '100%' : undefined,
            minWidth:       minWidth ? `${minWidth}px` : undefined,
            height:         `${sizing.height}px`,
            padding:        '0 10px',
            fontFamily:     'var(--font-mono)',
            fontSize:       sizing.triggerFontSize,
            color:          selected ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            background:     triggerBg,
            border:         `1px solid ${borderColor}`,
            borderRadius:   'var(--radius-sm)',
            cursor:         locked ? 'not-allowed' : 'pointer',
            opacity:        locked ? 0.6 : 1,
            outline:        'none',
            textAlign:      'left',
            transition:     'border-color 150ms ease',
            boxSizing:      'border-box',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayLabel}
          </span>
          <IconChevronDown
            size={14}
            style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>

        {/* Dropdown panel — fixed positioned, flips upward when near bottom of viewport */}
        {open && panelPos && (
          <div
            ref={listRef}
            role="listbox"
            aria-label={label}
            data-select-panel="true"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position:     'fixed',
              left:         panelPos.left,
              minWidth:     panelPos.width,
              ...(panelPos.above
                ? { bottom: panelPos.bottom }
                : { top:    panelPos.top }
              ),
              zIndex:       9999,
              background:   'var(--color-surface)',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow:    'var(--shadow-lg)',
              padding:      '4px',
              maxHeight:    `${PANEL_MAX_HEIGHT}px`,
              overflowY:    'auto',
            }}
          >
            {options.map((item, groupIdx) => {
              if (isGroup(item)) {
                return (
                  <div key={item.group}>
                    {groupIdx > 0 && (
                      <div style={{ height: '1px', background: 'var(--color-border)', margin: '4px 0' }} />
                    )}
                    <div style={{
                      padding:       '5px 10px 3px',
                      fontFamily:    'var(--font-mono)',
                      fontSize:      '10px',
                      fontWeight:    700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color:         'var(--color-text-tertiary)',
                    }}>
                      {item.group}
                    </div>
                    {item.options.map((opt) => {
                      const idx = flat.indexOf(opt)
                      return <OptionRow key={opt.value} opt={opt} idx={idx} activeIdx={activeIdx} selectedValue={value} size={size} onSelect={(v) => { onChange(v); setOpen(false) }} onHover={setActiveIdx} />
                    })}
                  </div>
                )
              }
              const idx = flat.indexOf(item)
              return (
                <OptionRow key={item.value} opt={item} idx={idx} activeIdx={activeIdx} selectedValue={value} size={size} onSelect={(v) => { onChange(v); setOpen(false) }} onHover={setActiveIdx} />
              )
            })}
          </div>
        )}

        {error && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Option row ───────────────────────────────────────────────────────────────

function OptionRow({
  opt, idx, activeIdx, selectedValue, size, onSelect, onHover,
}: {
  opt:           SelectOption
  idx:           number
  activeIdx:     number
  selectedValue: string
  size:          'sm' | 'md'
  onSelect:      (v: string) => void
  onHover:       (idx: number) => void
}) {
  const isActive   = idx === activeIdx
  const isSelected = opt.value === selectedValue
  const sizing     = SIZE_MAP[size]

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-disabled={opt.disabled}
      data-idx={idx}
      onMouseEnter={() => { if (!opt.disabled) onHover(idx) }}
      onClick={() => { if (!opt.disabled) onSelect(opt.value) }}
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        sizing.optionPadding,
        borderRadius:   'var(--radius-sm)',
        fontFamily:     'var(--font-mono)',
        fontSize:       sizing.optionFontSize,
        color:          'var(--color-text-primary)',
        background:     isActive && !opt.disabled ? 'var(--color-bg)' : 'transparent',
        cursor:         opt.disabled ? 'default' : 'pointer',
        opacity:        opt.disabled ? 0.5 : 1,
        userSelect:     'none',
        transition:     'background 80ms ease',
        whiteSpace:     'nowrap',
      }}
    >
      <span>{opt.label}</span>
      {isSelected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginLeft: '8px', color: 'var(--color-accent)' }}>
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}