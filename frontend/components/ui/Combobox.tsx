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
}

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
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const [matched, setMatched] = useState<T | null>(null)

  const query = value.trim().toLowerCase()
  const matches = query
    ? options.filter(o => getLabel(o).toLowerCase().includes(query)).slice(0, maxResults)
    : []

  function handleTextChange(text: string) {
    setMatched(null)
    onChange(text, null)
    setOpen(true)
  }

  function handleSelect(option: T) {
    const label = getLabel(option)
    setMatched(option)
    onChange(label, option)
    setOpen(false)
  }

  const showHint = value.trim().length > 0 && matched === null

  return (
    <div style={{ position: 'relative' }}>
      {label && (
        <label style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          {label}
        </label>
      )}
      <Input
        type="text"
        value={value}
        placeholder={placeholder ?? "Type to search..."}
        onChange={e => handleTextChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        fullWidth
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: '6px', marginTop: '2px', maxHeight: '180px', overflowY: 'auto',
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
        </div>
      )}
      {showHint && (
        <p style={{ fontSize: '12px', color: allowFreeText ? 'var(--color-text-secondary)' : 'var(--color-danger)', marginTop: '2px' }}>
          {allowFreeText ? "No matching option — will be saved as custom text." : "No matching option — select one from the list to continue."}
        </p>
      )}
    </div>
  )
}