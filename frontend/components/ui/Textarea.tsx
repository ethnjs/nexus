'use client'

import { forwardRef, TextareaHTMLAttributes, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

type InputFont = 'sans' | 'mono' | 'serif'
type InputSize = 'xs' | 'sm' | 'md'
// primary -- light gray; secondary -- white (matches Input's variant)
type InputVariant = 'primary' | 'secondary'

interface TextProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  fullWidth?: boolean
  rows?: number
  font?: InputFont
  size?: InputSize
  variant?: InputVariant
  /**
   * Pops the textarea out into a larger floating box (top-left corner
   * anchored to the collapsed box) while focused or hovered. Collapses once
   * it's both blurred and no longer hovered. Use for cramped table cells.
   */
  expandable?: boolean
  expandedWidth?: string
  expandedHeight?: string
  /** Grows the box to fit wrapped content instead of scrolling internally —
   * e.g. a 1-row textarea that should expand as the text wraps to more lines. */
  autoGrow?: boolean
}

const FONT_MAP: Record<InputFont, string> = {
  sans:  'var(--font-sans)',
  mono:  'var(--font-mono)',
  serif: 'var(--font-serif)',
}

// sm matches Input/Button's 28px — same size name, same height everywhere.
const SIZE_MAP: Record<InputSize, { height?: string; padding: string; fontSize: string }> = {
  xs: { height: '26px', padding: '3px 6px', fontSize: '11px' },
  sm: { height: '28px', padding: '5px 10px', fontSize: '13px' },
  md: { padding: '16px', fontSize: '14px' },
}

const BACKGROUND_MAP: Record<InputVariant, string> = {
  primary:   'var(--color-bg)',
  secondary: 'var(--color-surface)',
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextProps>(
  ({
    label, error, fullWidth, rows = 4, font = 'mono', size = 'md', variant = 'primary', className = '', id, value, style,
    expandable = false, expandedWidth = '280px', expandedHeight = '140px', autoGrow = false,
    onFocus, onBlur, onMouseEnter, onMouseLeave,
    ...props
  }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const sizing = SIZE_MAP[size]

    const innerRef = useRef<HTMLTextAreaElement | null>(null)
    function setRefs(node: HTMLTextAreaElement | null) {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = node
    }

    const [focused, setFocused] = useState(false)
    const [hovering, setHovering] = useState(false)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
      if (!expandable) return
      if (focused) setExpanded(true)
      else if (!hovering) setExpanded(false)
    }, [expandable, focused, hovering])

    // Grows the box with content instead of scrolling internally — reset to
    // 'auto' first so shrinking (e.g. deleting a wrapped line) isn't stuck at
    // the previous scrollHeight. scrollHeight excludes the 1px top/bottom
    // border, so it's added back here — box-sizing is border-box, so without
    // it the assigned height comes up 2px short of the content it just measured.
    useLayoutEffect(() => {
      if (!autoGrow || !innerRef.current) return
      const el = innerRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }, [autoGrow, value])

    // Once the box collapses back down, scroll it back to the top so it
    // doesn't show a mid-scroll snippet of a long note in the small view.
    useEffect(() => {
      if (!expanded && innerRef.current) {
        innerRef.current.scrollTop = 0
      }
    }, [expanded])

    // While expanding, wait for the box to finish growing before revealing
    // the caret — otherwise the caret's scroll-into-view fires mid-transition
    // and the box appears to jump/scroll instead of smoothly opening.
    useEffect(() => {
      if (!expandable || !expanded) return
      const el = innerRef.current
      if (!el) return
      function revealCaret(ev: TransitionEvent) {
        if (ev.propertyName !== 'height') return
        const end = el!.value.length
        el!.setSelectionRange(end, end)
      }
      el.addEventListener('transitionend', revealCaret)
      return () => el.removeEventListener('transitionend', revealCaret)
    }, [expandable, expanded])

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '8px',
        width: fullWidth ? '100%' : undefined,
        position: expandable ? 'relative' : undefined,
        height: expandable ? sizing.height : undefined,
      }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
            }}
          >{label}</label>
        )}
        <textarea
          ref={setRefs}
          id={inputId}
          rows={rows}
          style={{
            height: autoGrow ? undefined : sizing.height,
            padding: sizing.padding,
            fontFamily: FONT_MAP[font],
            fontSize: sizing.fontSize,
            background: BACKGROUND_MAP[variant],
            color: 'var(--color-text-primary)',
            border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
            width: fullWidth ? '100%' : undefined,
            resize: autoGrow ? 'none' : undefined,
            transition: 'border-color 150ms ease, width 150ms ease, height 150ms ease',
            overflow: autoGrow ? 'hidden' : sizing.height ? (expanded ? 'auto' : 'hidden') : undefined,
            ...(expandable ? {
              position: 'absolute', top: 0, left: 0,
              width: expanded ? expandedWidth : '100%',
              height: expanded ? expandedHeight : sizing.height,
              zIndex: expanded ? 30 : 1,
              boxShadow: expanded ? 'var(--shadow-md)' : undefined,
              resize: 'none',
            } : {}),
            ...style,
          }}
          onMouseDown={e => {
            // While collapsed, treat the box like a button: clicking it
            // shouldn't drop the caret where the mouse landed — it should
            // always land at the end of the text, like opening it fresh.
            // Safe to set immediately here since the box is still hidden-
            // overflow at this point, so there's nothing to scroll yet; the
            // post-expand reveal happens in the transitionend handler above.
            if (expandable && document.activeElement !== e.currentTarget) {
              e.preventDefault()
              const el = e.currentTarget
              el.scrollTop = 0
              const end = el.value.length
              el.setSelectionRange(end, end)
              el.focus()
            }
          }}
          onFocus={e => {
            e.target.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border-strong)'
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={e => {
            e.target.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)'
            setFocused(false)
            onBlur?.(e)
          }}
          onMouseEnter={e => { setHovering(true); onMouseEnter?.(e) }}
          onMouseLeave={e => { setHovering(false); onMouseLeave?.(e) }}
          className={className}
          value={value ?? ''}
          {...props}
        />
        {error && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
