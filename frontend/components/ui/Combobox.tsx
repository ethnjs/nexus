'use client'

import { KeyboardEvent, ReactNode, useRef, useState } from "react"
import { Input } from "@/components/ui/Input"
import { enterIndex, OptionList, stepActive, type ListOption } from "@/components/ui/OptionList"

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

  // The shared list (see OptionList): fixed off the field's rect, so no
  // scrolling ancestor clips it. Its rows are the matches, then "Use “…”".
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(-1)
  const listOptions: ListOption[] = [
    ...matches.map((option): ListOption => {
      const disabled = getDisabled?.(option) ?? false
      return {
        key: String(getId(option)), label: getLabel(option), disabled,
        reason: disabled ? getDisabledReason?.(option) : undefined,
      }
    }),
    ...(showCustomRow ? [{ key: '__custom__', label: `Use “${value.trim()}”`, muted: true }] : []),
  ]

  function pick(index: number) {
    if (index < matches.length) handleSelect(matches[index])
    else handleSelectCustom()
  }

  // ↑/↓ move through the list; Enter takes the highlighted row, or with
  // nothing highlighted the exact match, else the first one — so typing part
  // of a name and pressing Enter fills it in. An empty field picks nothing.
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (locked) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActive((i) => stepActive(listOptions, i, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter' && dropdownOpen && (active >= 0 || query)) {
      const exact = matches.findIndex((o) => getLabel(o).toLowerCase() === query && !getDisabled?.(o))
      const index = active >= 0 ? active : exact >= 0 ? exact : enterIndex(listOptions, -1)
      if (index < 0) return
      e.preventDefault()
      pick(index)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  function handleTextChange(text: string) {
    if (locked) return
    const t = text.trim().toLowerCase()
    let match = t ? options.find(o => getLabel(o).toLowerCase() === t) ?? null : null
    if (match && getDisabled?.(match)) match = null
    onChange(text, match)
    setTyped(true)
    setOpen(true)
    setActive(-1)
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
        ref={inputRef}
        label={label}
        labelExtra={labelExtra}
        required={required}
        type="text"
        value={value}
        placeholder={placeholder ?? "Type to search..."}
        onChange={e => handleTextChange(e.target.value)}
        onFocus={() => { if (!locked) { setOpen(true); setTyped(false); setActive(-1) } }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        error={displayedError}
        size={size}
        variant={variant}
        locked={locked}
        fullWidth
      />
      {dropdownOpen && !locked && (
        <OptionList
          anchorRef={inputRef}
          options={listOptions}
          active={active}
          onActiveChange={setActive}
          onPick={pick}
          size={size}
          matchWidth
          emptyMessage={showEmptyRow ? emptyMessage : undefined}
        />
      )}
    </div>
  )
}