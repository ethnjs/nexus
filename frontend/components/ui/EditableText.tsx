'use client'

import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { enterChoice, OptionList, stepActive, suggestionRows } from '@/components/ui/OptionList'

interface EditableTextProps {
  value: string
  /** May throw/reject — the error's message is shown under the field and editing stays open. */
  onSave: (value: string) => void | Promise<void>
  /** Applied to both the display text and the input — keep them identical so entering edit mode doesn't shift surrounding layout. */
  textStyle?: CSSProperties
  title?: string
  /** Mount already in edit mode with the field focused — for text created empty by a button press, where the next thing the user does is always name it. */
  startEditing?: boolean
  /** Reads as plain text and can't enter edit mode — put the reason in `title`. */
  locked?: boolean
  /**
   * Shown in place of an empty value, muted. Without it an empty field
   * renders nothing and there is no target left to click — which matters for
   * any nullable field. Never becomes the draft.
   */
  placeholder?: string
  /**
   * Let an empty value save (as ""), instead of treating it as a cancel.
   * Opt-in: for a required field, clearing it and clicking away should abandon
   * the edit, not blank the record. A nullable field needs the opposite —
   * otherwise a wrong abbreviation can never be removed.
   */
  allowEmpty?: boolean
  /** Offered in a list as you type — free text is still allowed. Use
   *  EditableCombobox, which requires it, rather than passing it here. */
  suggestions?: string[]
}

const DEFAULT_TEXT_STYLE: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 500,
}

// Applied to both the resting span and the input so the swap can't change the
// box's height. Without the explicit line-height the two measure differently,
// and without display:block the input sits on the text baseline — leaving
// descender space under it that makes the editing box taller. Either one
// shifts the text vertically inside a centred flex row, which is exactly what
// edit-in-place is supposed to avoid.
const BOX_STYLE: CSSProperties = { lineHeight: 1.4, display: 'block' }

// Click-to-edit text that reads as plain text until clicked — no visible
// field chrome, just an underline once active. The input's width is driven
// by a hidden mirror span (same font) rather than a fixed size, so the
// span->input swap never shifts whatever sits next to it, and the box keeps
// tracking width as the user types.
export function EditableText({ value, onSave, textStyle, title = 'Click to edit', startEditing = false, locked = false, placeholder, allowEmpty = false, suggestions }: EditableTextProps) {
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [inputWidth, setInputWidth] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  // Enter/Esc end editing from the keyboard; focus then goes back to the
  // resting text so Tab carries on from here, not from the top of the page.
  // A blur-save doesn't — focus already went where the user clicked.
  const restRef = useRef<HTMLSpanElement>(null)
  const refocus = useRef(false)
  // Combobox mode: which suggestion the arrow keys are on (-1 = none).
  const [highlight, setHighlight] = useState(-1)
  const rows = editing && suggestions ? suggestionRows(suggestions, draft) : { names: [], options: [] }
  const listOpen = rows.options.length > 0

  // Depends on `editing` too: startEdit's setDraft(value) is a no-op when
  // draft is already `value`, so `draft` alone wouldn't change on the
  // span's first mount and this effect would skip, leaving inputWidth
  // stuck at its stale (0) value.
  useLayoutEffect(() => {
    if (measureRef.current) setInputWidth(measureRef.current.offsetWidth)
  }, [draft, editing])

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      restRef.current?.focus()
    }
    if (editing && inputRef.current) {
      inputRef.current.focus()
      const len = inputRef.current.value.length
      inputRef.current.setSelectionRange(len, len)
    }
  }, [editing])

  function startEdit() {
    setDraft(value)
    setError(undefined)
    setHighlight(-1)
    setEditing(true)
  }

  // A ref, not the `saving` state: Enter disables the input, and a browser
  // that blurs it on disable would otherwise start a second save in the same tick.
  const inFlight = useRef(false)

  async function save(text: string = draft) {
    if (inFlight.current) return
    const trimmed = text.trim()
    if ((!trimmed && !allowEmpty) || trimmed === value) {
      setEditing(false)
      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      // Still editing, so nothing to hand focus back to.
      refocus.current = false
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const style = { ...DEFAULT_TEXT_STYLE, ...textStyle }

  if (editing) {
    return (
      <span style={{ position: 'relative', display: 'inline-block', verticalAlign: 'top' }}>
        <span ref={measureRef} style={{ ...style, ...BOX_STYLE, position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' }}>
          {draft || ' '}
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setHighlight(-1) }}
          onBlur={() => save()}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && listOpen) { e.preventDefault(); setHighlight((h) => stepActive(rows.options, h, 1)) }
            if (e.key === 'ArrowUp' && listOpen) { e.preventDefault(); setHighlight((h) => stepActive(rows.options, h, -1)) }
            if (e.key === 'Enter') {
              e.preventDefault()
              refocus.current = true
              // Highlighted row, else the exact/first match for typed text
              // (see enterChoice); empty text saves as empty.
              const picked = suggestions ? enterChoice(rows.names, highlight, draft) : draft
              setDraft(picked)
              save(picked)
            }
            if (e.key === 'Escape') { e.preventDefault(); refocus.current = true; setEditing(false) }
          }}
          disabled={saving}
          style={{
            ...style,
            ...BOX_STYLE,
            // Wider floor with suggestions: an empty field there is the
            // normal start, and a 20px one hides what is being typed.
            width: `${Math.max(inputWidth, suggestions ? 80 : 20)}px`,
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
        {listOpen && (
          <OptionList
            anchorRef={inputRef}
            options={rows.options}
            active={highlight}
            onActiveChange={setHighlight}
            onPick={(i) => { const picked = rows.names[i] ?? draft.trim(); setDraft(picked); save(picked) }}
          />
        )}
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
      ref={restRef}
      onClick={locked ? undefined : startEdit}
      // Reachable by Tab, and Enter starts editing — same as a click.
      tabIndex={locked ? undefined : 0}
      onKeyDown={locked ? undefined : (e) => {
        if (e.key === 'Enter') { e.preventDefault(); startEdit() }
      }}
      title={title}
      style={{
        ...style,
        ...BOX_STYLE,
        color: 'var(--color-text-primary)',
        cursor: locked ? 'not-allowed' : 'text',
        borderBottom: '1px solid transparent',
        // Muted only while standing in for an absent value — the placeholder
        // shouldn't read as content.
        ...(value ? {} : { color: 'var(--color-text-tertiary)' }),
      }}
    >
      {value || placeholder}
    </span>
  )
}

/**
 * EditableText with suggestions: reads as plain text, and while editing
 * offers matching options under the field (up/down to move, Enter or a click
 * to pick). Free text still saves — the caller decides what an unknown value
 * means (e.g. create the building).
 */
export function EditableCombobox(props: EditableTextProps & { suggestions: string[] }) {
  return <EditableText {...props} />
}
