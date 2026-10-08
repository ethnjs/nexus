'use client'

import {
  useState,
  useRef,
  useEffect,
  useId,
  ReactNode,
  KeyboardEvent,
} from 'react'
import { IconChevronDown } from './Icons'
import { OptionList, type ListOption } from './OptionList'

// ─── Types ────────────────────────────────────────────────────────────────────

// TODO(decision): DropdownOption.value is string-only. Accepting string | number would require
// changing DropdownProps.value and onChange signature, propagating to all call sites.
// Current workaround: convert numbers to string at the call site with String().
export interface DropdownOption {
  value:     string
  label:     string
  /** Secondary line rendered under the label, e.g. a location or subtitle. */
  subtitle?: string
  disabled?: boolean
  /** Rendered after the label, e.g. a "Removed" marker on a past answer. */
  badge?:    ReactNode
}

export interface DropdownOptionGroup {
  group:   string
  options: DropdownOption[]
}

export type DropdownItem = DropdownOption | DropdownOptionGroup

function isGroup(item: DropdownItem): item is DropdownOptionGroup {
  return 'group' in item
}

function flatOptions(items: DropdownItem[]): DropdownOption[] {
  return items.flatMap((item) => (isGroup(item) ? item.options : [item]))
}

function toListOption(opt: DropdownOption, value: string): ListOption {
  return {
    key: opt.value, label: opt.label, subtitle: opt.subtitle, badge: opt.badge,
    disabled: opt.disabled, selected: opt.value === value,
  }
}

function matchesQuery(opt: DropdownOption, query: string): boolean {
  return opt.label.toLowerCase().includes(query) || (opt.subtitle?.toLowerCase().includes(query) ?? false)
}

// Filters options/groups by query, dropping groups left with no matches.
function filterItems(items: DropdownItem[], query: string): DropdownItem[] {
  if (!query) return items
  return items.flatMap((item): DropdownItem[] => {
    if (isGroup(item)) {
      const matched = item.options.filter((o) => matchesQuery(o, query))
      return matched.length ? [{ ...item, options: matched }] : []
    }
    return matchesQuery(item, query) ? [item] : []
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DropdownProps {
  value:        string
  onChange:     (value: string) => void
  options:      DropdownItem[]
  label?:       string
  placeholder?: string
  error?:       string
  locked?:      boolean
  fullWidth?:   boolean
  /** Marks the label with an asterisk, same as Input/Combobox. Display only
      — nothing here enforces it, since a Dropdown has no form submission of
      its own to block. */
  required?:    boolean
  size?:        'sm' | 'md'
  /** Minimum width of the trigger in px. Useful for sm dropdowns that need a fixed floor. */
  minWidth?:    number
  /** Fixed width of the trigger (and panel) in px, e.g. for a dropdown that sits in a fixed-width toolbar slot. */
  width?:       number
  /** Trigger is exactly as wide as its own label, so the chevron sits against
   *  the text instead of at the far edge of a fixed box. For a dropdown that
   *  reads as part of a sentence rather than as a form field. The panel still
   *  opens at its own natural width. */
  fitContent?:  boolean
  // primary -- var(--color-bg); secondary -- var(--color-surface);
  // transparent -- no fill and no border until hovered or open, for a trigger
  // that sits inside other chrome (the Topbar's page crumb) where a boxed
  // control would read as a second switcher.
  variant?:     'primary' | 'secondary' | 'transparent'
  id?:          string
  /** Message shown in the panel when there are no options. */
  emptyMessage?: string
  /** Shows a search field at the top of the panel that filters options by label/subtitle. */
  searchable?:   boolean
  /** Trailing action row rendered below the options, e.g. "+ New tournament". */
  footerLabel?:  string
  footerIcon?:   ReactNode
  onFooterClick?: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Heights match Button/Input's scale — same size name, same height everywhere.
const SIZE_MAP: Record<'sm' | 'md', { height: number; triggerFontSize: string; optionPadding: string; optionFontSize: string }> = {
  sm: { height: 28, triggerFontSize: '13px', optionPadding: '5px 8px',  optionFontSize: '13px' },
  md: { height: 36, triggerFontSize: '14px', optionPadding: '7px 10px', optionFontSize: '14px' },
}

const BACKGROUND_MAP: Record<'primary' | 'secondary' | 'transparent', string> = {
  primary:     'var(--color-bg)',
  secondary:   'var(--color-surface)',
  transparent: 'transparent',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Dropdown({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select...',
  error,
  locked = false,
  fullWidth = false,
  required = false,
  size = 'md',
  minWidth,
  width,
  fitContent = false,
  variant = 'primary',
  id,
  emptyMessage,
  searchable = false,
  footerLabel,
  footerIcon,
  onFooterClick,
}: DropdownProps) {
  const generatedId               = useId()
  const triggerId                 = id ?? generatedId
  const [open, setOpen]           = useState(false)
  const [focused, setFocused]     = useState(false)
  const [hovered, setHovered]     = useState(false)
  const [activeIdx, setActiveIdx] = useState<number>(-1)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef              = useRef<HTMLDivElement>(null)
  const triggerRef                = useRef<HTMLButtonElement>(null)
  const listRef                   = useRef<HTMLDivElement>(null)
  const searchRef                 = useRef<HTMLInputElement>(null)

  const sizing    = SIZE_MAP[size]
  const triggerBg = BACKGROUND_MAP[variant]

  // `flat` drives keyboard nav/rendering and narrows as the user searches;
  // `flatAll` stays unfiltered so the trigger keeps showing the selected
  // label even after the panel closes with a stale search query.
  const visibleOptions = searchable ? filterItems(options, searchQuery.trim().toLowerCase()) : options
  const flat          = flatOptions(visibleOptions)
  const flatAll        = flatOptions(options)
  const selected       = flatAll.find((o) => o.value === value)
  const listOptions: ListOption[] = visibleOptions.flatMap((item) => (isGroup(item)
    ? item.options.map((o) => ({ ...toListOption(o, value), group: item.group }))
    : [toListOption(item, value)]))
  const displayLabel   = selected?.label ?? placeholder

  useEffect(() => {
    if (!open) { setSearchQuery(''); return }
    if (searchable) searchRef.current?.focus()
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

  // ── Set active index to current value when opening ────────────────────────

  useEffect(() => {
    if (open) {
      const idx = flat.findIndex((o) => o.value === value)
      setActiveIdx(idx >= 0 ? idx : 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Keyboard handling ─────────────────────────────────────────────────────

  function moveActive(direction: 1 | -1) {
    setActiveIdx((prev) => {
      let next = prev + direction
      while (next >= 0 && next < flat.length && flat[next]?.disabled) next += direction
      return next >= 0 && next < flat.length ? next : prev
    })
  }

  function selectActive() {
    const opt = flat[activeIdx]
    if (opt && !opt.disabled) { onChange(opt.value); setOpen(false) }
  }

  // Trigger button: Enter/Space both open the panel and (once open) confirm
  // the active option, since there's no text field competing for those keys.
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (locked) return
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (open) { selectActive() } else { setOpen(true) }
        break
      case 'ArrowDown':
        e.preventDefault()
        if (!open) { setOpen(true) } else { moveActive(1) }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) { setOpen(true) } else { moveActive(-1) }
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

  // Search field: the panel is already open and the field owns text input,
  // so Space must stay a literal character — only nav/confirm keys are handled.
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        selectActive()
        break
      case 'ArrowDown':
        e.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveActive(-1)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        break
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // TODO: color-border-strong is too similar to color-border — focused state is barely visible
  const borderColor = error ? 'var(--color-danger)' : focused && !open
    ? 'var(--color-border-strong)'
    : 'var(--color-border)'
  // A transparent trigger shows its edges only once it is being used —
  // hovered, focused or open. The border is still *there* the rest of the
  // time, in the surface colour, so nothing shifts when it appears.
  const showsEdges = !!error || focused || open || hovered
  const transparent = variant === 'transparent'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: fullWidth ? '100%' : undefined }}>
      {label && (
        <label
          htmlFor={triggerId}
          onClick={(e) => e.preventDefault()}
          style={{
            fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
          }}
        >
          {label}
          {required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
        </label>
      )}

      <div ref={containerRef} style={{ position: 'relative', width: fullWidth ? '100%' : width ? `${width}px` : undefined }}>
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
          // A transparent trigger only counts keyboard focus: a click leaves
          // the button focused after its menu closes, and its border would
          // stay up until you clicked somewhere else.
          onFocus={(e) => setFocused(variant !== 'transparent' || e.currentTarget.matches(':focus-visible'))}
          onBlur={() => setFocused(false)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            gap:            '8px',
            width:          fullWidth ? '100%' : width ? `${width}px` : undefined,
            minWidth:       minWidth ? `${minWidth}px` : undefined,
            height:         `${sizing.height}px`,
            // A fitted trigger is sized by its label, so it must not also
            // stretch the gap between label and chevron to fill a box.
            ...(fitContent ? { justifyContent: 'flex-start', gap: '4px' } : null),
            padding:        fitContent ? '0 6px' : '0 10px',
            fontFamily:     'var(--font-sans)',
            fontSize:       sizing.triggerFontSize,
            fontWeight:     500,
            color:          selected ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            background:     transparent && !showsEdges ? 'transparent' : triggerBg,
            border:         `1px solid ${transparent && !showsEdges ? 'transparent' : borderColor}`,
            borderRadius:   'var(--radius-md)',
            cursor:         locked ? 'not-allowed' : 'pointer',
            opacity:        locked ? 0.6 : 1,
            outline:        'none',
            textAlign:      'left',
            transition:     'border-color 150ms ease, background 150ms ease',
            boxSizing:      'border-box',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayLabel}
            </span>
            {selected?.badge}
          </span>
          <IconChevronDown
            size={14}
            style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>

        {/* The shared list (see OptionList) — fixed positioned, flips upward near the bottom of the viewport. */}
        {open && (
          <OptionList
            anchorRef={triggerRef}
            panelRef={listRef}
            label={label}
            options={listOptions}
            active={activeIdx}
            onActiveChange={setActiveIdx}
            onPick={(i) => { onChange(flat[i].value); setOpen(false) }}
            size={size}
            matchWidth
            emptyMessage={emptyMessage}
            header={searchable ? (
              <div style={{ padding: '6px 8px' }}>
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setActiveIdx(0) }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search..."
                  style={{
                    width: '100%', height: '26px',
                    padding: '0 8px', boxSizing: 'border-box',
                    fontFamily: 'var(--font-sans)', fontSize: '12px',
                    color: 'var(--color-text-primary)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    outline: 'none',
                  }}
                />
              </div>
            ) : undefined}
            footer={footerLabel ? (
              <>
                {flat.length > 0 && <div style={{ height: '1px', background: 'var(--color-border)' }} />}
                <div
                  role="button"
                  onClick={() => { onFooterClick?.(); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    // Same padding as a list row, not a hardcoded pair: at
                    // sm the old 10px 16px gave the footer double the option
                    // rows' vertical padding and twice their indent, so it read
                    // as a different size of control.
                    padding: sizing.optionPadding,
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: sizing.optionFontSize,
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'background 80ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-bg)'
                    // Clear the option highlight as well: activeIdx is only
                    // reset by hovering another option, so arriving here from
                    // the last row left it highlighted alongside this one.
                    setActiveIdx(-1)
                  }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {footerIcon}
                  {footerLabel}
                </div>
              </>
            ) : undefined}
          />
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
