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
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)

  const query = value.trim().toLowerCase()
  // Focusing an empty field shows every option (up to maxResults) rather
  // than nothing — lets the TD see what's available before typing anything.
  const matches = query
    ? options.filter(o => getSearchText(o).toLowerCase().includes(query)).slice(0, maxResults)
    : open ? options.slice(0, maxResults) : []

  const exactMatch = matches.some(o => getLabel(o).toLowerCase() === query)
  const showCustomRow = allowFreeText && query.length > 0 && !exactMatch && matches.length < CUSTOM_THRESHOLD
  const dropdownOpen = open && (matches.length > 0 || showCustomRow)

  function handleTextChange(text: string) {
    if (locked) return
    const t = text.trim().toLowerCase()
    let match = t ? options.find(o => getLabel(o).toLowerCase() === t) ?? null : null
    if (match && getDisabled?.(match)) match = null
    onChange(text, match)
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
        onFocus={() => !locked && setOpen(true)}
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