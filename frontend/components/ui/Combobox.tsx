'use client'

import { useState } from "react"
import { Input } from "@/components/ui/Input"

interface ComboboxProps<T> {
  options:  T[]
  getId:    (option: T) => string | number
  getLabel: (option: T) => string

  value:    string
  onChange: (text: string, matched: T | null) => void

  allowFreeText?: boolean
  placeholder?:   string
  label?:         string
  maxResults?:    number
  /** External error, takes priority over the internal strict-mode "no match" hint. */
  error?: string
}

const CUSTOM_THRESHOLD = 3

export function Combobox<T>({
  options,
  getId,
  getLabel,
  value,
  onChange,
  allowFreeText = true,
  placeholder,
  label,
  maxResults = 8,
  error,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const [matched, setMatched] = useState<T | null>(null)

  const query = value.trim().toLowerCase()
  const matches = query
    ? options.filter(o => getLabel(o).toLowerCase().includes(query)).slice(0, maxResults)
    : []

  const exactMatch = matches.some(o => getLabel(o).toLowerCase() === query)
  const showCustomRow = allowFreeText && query.length > 0 && !exactMatch && matches.length < CUSTOM_THRESHOLD
  const dropdownOpen = open && (matches.length > 0 || showCustomRow)

  function handleTextChange(text: string) {
    setMatched(null)
    onChange(text, null)
    setOpen(true)
  }

  function handleSelect(option: T) {
    const optLabel = getLabel(option)
    setMatched(option)
    onChange(optLabel, option)
    setOpen(false)
  }

  function handleSelectCustom() {
    setOpen(false)
  }

  const showStrictHint = !open && !allowFreeText && value.trim().length > 0 && matched === null
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