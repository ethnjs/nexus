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

  // The bubble is centred on its trigger, so one near a screen edge hangs off
  // it — which on a phone is most of them. CSS can't know which edge is close,
  // so measure once per appearance and nudge the bubble back inside. The arrow
  // shifts the opposite way to stay pointing at the trigger.
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    if (!visible) {
      setShift(0)
      return
    }
    const el = bubbleRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let dx = 0
    if (rect.left < margin) dx = margin - rect.left
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right
    // Runs once per appearance: setting shift re-renders but doesn't re-fire
    // this effect, so there's no measure/adjust loop.
    if (dx !== 0) setShift(dx)
  }, [visible, message, status])

  const bubbleStyle: CSSProperties = {
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
    <div className={styles.wrapper} style={style} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {visible && (
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