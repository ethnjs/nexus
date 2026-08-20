'use client'

import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface EditableTextProps {
  value: string
  /** May throw/reject — the error's message is shown under the field and editing stays open. */
  onSave: (value: string) => void | Promise<void>
  /** Applied to both the display text and the input — keep them identical so entering edit mode doesn't shift surrounding layout. */
  textStyle?: CSSProperties
  title?: string
}

const DEFAULT_TEXT_STYLE: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 500,
}

// Click-to-edit text that reads as plain text until clicked — no visible
// field chrome, just an underline once active. The input's width is driven
// by a hidden mirror span (same font) rather than a fixed size, so the
// span->input swap never shifts whatever sits next to it, and the box keeps
// tracking width as the user types.
export function EditableText({ value, onSave, textStyle, title = 'Click to edit' }: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [inputWidth, setInputWidth] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)

  // Depends on `editing` too: startEdit's setDraft(value) is a no-op when
  // draft is already `value`, so `draft` alone wouldn't change on the
  // span's first mount and this effect would skip, leaving inputWidth
  // stuck at its stale (0) value.
  useLayoutEffect(() => {
    if (measureRef.current) setInputWidth(measureRef.current.offsetWidth)
  }, [draft, editing])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      const len = inputRef.current.value.length
      inputRef.current.setSelectionRange(len, len)
    }
  }, [editing])

  function startEdit() {
    setDraft(value)
    setError(undefined)
    setEditing(true)
  }

  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const style = { ...DEFAULT_TEXT_STYLE, ...textStyle }

  if (editing) {
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <span ref={measureRef} style={{ ...style, position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' }}>
          {draft || ' '}
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          disabled={saving}
          style={{
            ...style,
            width: `${Math.max(inputWidth, 20)}px`,
            boxSizing: 'content-box',
            color: 'var(--color-text-primary)',
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border-strong)'}`,
            outline: 'none',
            padding: 0,
            margin: 0,
          }}
        />
        {error && (
          <span style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '4px', whiteSpace: 'nowrap',
            fontFamily: 'var(--font-sans)', fontSize: '11px', color: 'var(--color-danger)',
          }}>
            {error}
          </span>
        )}
      </span>
    )
  }

  return (
    <span
      onClick={startEdit}
      title={title}
      style={{ ...style, color: 'var(--color-text-primary)', cursor: 'text', borderBottom: '1px solid transparent' }}
    >
      {value}
    </span>
  )
}
