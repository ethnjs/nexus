'use client'

import { ReactNode, useState } from "react"
import { Input } from "@/components/ui/Input"

type ComboboxSize = 'sm' | 'md'
type ComboboxVariant = 'primary' | 'secondary'

interface ComboboxProps<T> {
  options:  T[]
  getId:    (option: T) => string | number
  getLabel: (option: T) => string
  getSearchText?: (option: T) => string

  value:    string
  onChange: (text: string, matched: T | null) => void

  allowFreeText?: boolean
  placeholder?:   string
  label?:         string
  /** Rendered inline next to the label — e.g. an info icon + Tooltip. Ignored when label isn't set. */
  labelExtra?: ReactNode
  required?:      boolean
  maxResults?:    number
  error?: string
  size?: ComboboxSize
  variant?: ComboboxVariant
  locked?: boolean
  /** Rows for which this returns true render inert (dimmed, unselectable) instead of being filtered out — e.g. a field_key already in use elsewhere. */
  getDisabled?: (option: T) => boolean
  /** Short suffix shown after the label on a disabled row, e.g. "already in use". Only consulted when getDisabled(option) is true. */
  getDisabledReason?: (option: T) => string | undefined
  /** An inert row shown when the list is open with nothing in it — so a
   *  focused field with an empty catalog says so instead of showing nothing. */
  emptyMessage?: string
}

const CUSTOM_THRESHOLD = 3

export function Combobox<T>({
  options,
  getId,
  getLabel,
  getSearchText = getLabel,
  value,
  onChange,
  allowFreeText = true,
  placeholder,
  label,
  labelExtra,
  required,
  maxResults = 8,
  error,
  size = 'md',
  variant = 'primary',
  locked = false,
  getDisabled,
  getDisabledReason,
  emptyMessage,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  // Whether the text has been edited since the field took focus. Until it
  // has, the list shows every option rather than filtering by the current
  // value — otherwise focusing a filled field listed only the one option it
  // already held, and seeing the alternatives meant clearing it first.
  const [typed, setTyped] = useState(false)

  const query = value.trim().toLowerCase()
  // Focusing an empty field shows every option (up to maxResults) rather
  // than nothing — lets the TD see what's available before typing anything.
  const matches = query && typed
    ? options.filter(o => getSearchText(o).toLowerCase().includes(query)).slice(0, maxResults)
    : open ? options.slice(0, maxResults) : []

  // Against every option, not `matches`: matches is capped at maxResults and
  // is empty while the list is closed, and either would misreport a valid
  // value as unmatched — which the strict hint below turns into an error.
  const exactMatch = options.some(o => getLabel(o).toLowerCase() === query)
  const showCustomRow = allowFreeText && typed && query.length > 0 && !exactMatch
    && matches.length < CUSTOM_THRESHOLD
  const showEmptyRow = !!emptyMessage && matches.length === 0 && !showCustomRow
  const dropdownOpen = open && (matches.length > 0 || showCustomRow || showEmptyRow)

  function handleTextChange(text: string) {
    if (locked) return
    const t = text.trim().toLowerCase()
    let match = t ? options.find(o => getLabel(o).toLowerCase() === t) ?? null : null
    if (match && getDisabled?.(match)) match = null
    onChange(text, match)
    setTyped(true)
    setOpen(true)
  }

  function handleSelect(option: T) {
    if (getDisabled?.(option)) return
    onChange(getLabel(option), option)
    setOpen(false)
  }

  function handleSelectCustom() {
    setOpen(false)
  }

  const showStrictHint = !open && !allowFreeText && value.trim().length > 0 && !exactMatch
  const displayedError = error ?? (showStrictHint ? "No matching option — select one from the list to continue." : undefined)

  return (
    <div style={{ position: 'relative' }}>
      <Input
        label={label}
        labelExtra={labelExtra}
        required={required}
        type="text"
        value={value}
        placeholder={placeholder ?? "Type to search..."}
        onChange={e => handleTextChange(e.target.value)}
        onFocus={() => { if (!locked) { setOpen(true); setTyped(false) } }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        error={displayedError}
        size={size}
        variant={variant}
        locked={locked}
        fullWidth
      />
      {dropdownOpen && !locked && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderTop: 'none',
          borderRadius: '0 0 6px 6px',
          maxHeight: '180px', overflowY: 'auto',
          boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
        }}>
          {matches.map(option => {
            const disabled = getDisabled?.(option) ?? false
            const reason = disabled ? getDisabledReason?.(option) : undefined
            return (
              <div
                key={getId(option)}
                onMouseDown={() => handleSelect(option)}
                title={reason}
                style={{
                  padding: '8px 10px', fontFamily: 'var(--font-sans)', fontSize: '14px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  color: disabled ? 'var(--color-text-tertiary)' : undefined,
                  display: 'flex', justifyContent: 'space-between', gap: '8px',
                }}
              >
                <span>{getLabel(option)}</span>
                {reason && (
                  <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontStyle: 'italic', flexShrink: 0 }}>
                    {reason}
                  </span>
                )}
              </div>
            )
          })}
          {showEmptyRow && (
            <div style={{
              padding: '8px 10px', fontFamily: 'var(--font-sans)', fontSize: '13px',
              color: 'var(--color-text-tertiary)', cursor: 'default',
            }}>
              {emptyMessage}
            </div>
          )}
          {showCustomRow && (
            <div
              onMouseDown={handleSelectCustom}
              style={{
                padding: '8px 10px', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: '14px',
                color: 'var(--color-text-secondary)',
                borderTop: matches.length > 0 ? '1px solid var(--color-border)' : undefined,
              }}
            >
              Use &ldquo;{value.trim()}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  )
}