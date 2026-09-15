"use client"

import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import styles from './Tooltip.module.css'
import { IconCheckCircle, IconInfo, IconWarning, IconXCircle } from "./Icons"



type TooltipVariant = 'info' | 'success' | 'warning' | 'error'

export type TooltipStatus = 'idle' | 'success' | 'warning' | 'error'

type TooltipProps = {
  variant: TooltipVariant
  status?: never
  message: string
  children: ReactNode
  showIcon?: boolean
  maxWidth?: number | string
  /** Applied to the wrapper div — e.g. width: '100%' so the hover target matches an untooltipped sibling's footprint (the wrapper is inline-flex by default, so it otherwise shrinks to the children's content width). */
  style?: CSSProperties
} | {
  variant?: never
  status: TooltipStatus
  message: Partial<Record<TooltipStatus, string | undefined>>
  children: ReactNode
  showIcon?: boolean
  maxWidth?: number | string
  style?: CSSProperties
}

// Distance from trigger to bubble — mirrors the .wrapper::after hover bridge
// that keeps the pointer from falling through that gap.
const ARROW_GAP = 10

const variantIcon: Record<TooltipVariant, ReactNode> = {
  'info': <IconInfo />,
  'success': <IconCheckCircle style={{color: 'var(--color-success)'}}/>,
  'warning': <IconWarning style={{color: 'var(--color-warning)'}}/>,
  'error': <IconXCircle style={{color: 'var(--color-danger)'}}/>
}

export function Tooltip({ variant, status, message, children, showIcon = true, maxWidth, style }: TooltipProps) {
  const [hovered, setHovered] = useState(false)
  const [autoShow, setAutoShow] = useState(false)

  const visible = (autoShow || (hovered && !!variant) || (hovered && !!status)) && (typeof message === 'string' ? !!message : !!message[status!])

  useEffect(() => {
    if (variant) return
    setAutoShow(true)
    const timerId = setTimeout(() => {
      setAutoShow(false)
    }, 3000)
    return () => clearTimeout(timerId)
  }, [status])

  const resolvedVariant = variant ?? (status !== 'idle' ? status : 'info')

  const wrapperRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const [shift, setShift] = useState(0)

  // position:fixed off the trigger's own rect rather than absolute inside the
  // wrapper: an absolute bubble is clipped by any ancestor with overflow:hidden
  // (the roster table's roles cell, Popover's scrolling list), which showed up
  // as an arrow with no bubble under it.
  useLayoutEffect(() => {
    if (!visible) {
      setAnchor(null)
      setShift(0)
      return
    }
    function measure() {
      const wrap = wrapperRef.current
      if (!wrap) return
      const r = wrap.getBoundingClientRect()
      setAnchor({ top: r.bottom + ARROW_GAP, left: r.left + r.width / 2 })
    }
    measure()
    // Capture phase so scrolling in any ancestor container, not just the
    // window, keeps the bubble stuck to its trigger.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [visible, message, status])

  // The bubble is centred on its trigger, so one near a screen edge hangs off
  // it — which on a phone is most of them. CSS can't know which edge is close,
  // so measure once per placement and nudge the bubble back inside. The arrow
  // shifts the opposite way to stay pointing at the trigger.
  useLayoutEffect(() => {
    if (!anchor) return
    const el = bubbleRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let dx = 0
    if (rect.left < margin) dx = margin - rect.left
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right
    // Setting shift re-renders but doesn't change `anchor`, so this doesn't
    // re-fire — no measure/adjust loop.
    setShift(dx)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])

  const bubbleStyle: CSSProperties = {
    top: anchor?.top,
    left: anchor?.left,
    transform: `translateX(calc(-50% + ${shift}px))`,
    ['--tooltip-arrow-shift' as string]: `${shift}px`,
    // min() so an explicit maxWidth can't exceed a narrow viewport — the
    // account page asks for 400px, which is wider than a phone screen.
    ...(maxWidth
      ? {
          maxWidth: `min(${typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth}, calc(100vw - 16px))`,
          width: 'max-content',
          whiteSpace: 'normal' as const,
        }
      : {}),
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper} style={style} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {visible && anchor && (
        <div
          ref={bubbleRef}
          className={`${styles.bubble} ${styles[resolvedVariant]}`}
          style={bubbleStyle}
        >
          {showIcon && variantIcon[resolvedVariant]}
          {typeof message === 'string' ? message : message[status!]}
        </div>
      )}
    </div>
  )
}