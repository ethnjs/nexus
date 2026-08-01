'use client'

import { useState } from "react"
import { Input } from "@/components/ui/Input"

type ComboboxSize = 'sm' | 'md'

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
  maxResults?:    number
  error?: string
  size?: ComboboxSize
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
  maxResults = 8,
  error,
  size = 'md',
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)

  const query = value.trim().toLowerCase()
  const matches = query
    ? options.filter(o => getSearchText(o).toLowerCase().includes(query)).slice(0, maxResults)
    : []

  const exactMatch = matches.some(o => getLabel(o).toLowerCase() === query)
  const showCustomRow = allowFreeText && query.length > 0 && !exactMatch && matches.length < CUSTOM_THRESHOLD
  const dropdownOpen = open && (matches.length > 0 || showCustomRow)

  function handleTextChange(text: string) {
    const t = text.trim().toLowerCase()
    const match = t ? options.find(o => getLabel(o).toLowerCase() === t) ?? null : null
    onChange(text, match)
    setOpen(true)
  }

  function handleSelect(option: T) {
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
        type="text"
        value={value}
        placeholder={placeholder ?? "Type to search..."}
        onChange={e => handleTextChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        error={displayedError}
        size={size}
        fullWidth
      />
      {dropdownOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderTop: 'none',
          borderRadius: '0 0 6px 6px',
          maxHeight: '180px', overflowY: 'auto',
          boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
        }}>
          {matches.map(option => (
            <div
              key={getId(option)}
              onMouseDown={() => handleSelect(option)}
              style={{ padding: '8px 10px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '14px' }}
            >
              {getLabel(option)}
            </div>
          ))}
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