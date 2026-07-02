import { ReactNode, useEffect, useState } from "react"
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
} | {
  variant?: never
  status: TooltipStatus
  message: Partial<Record<TooltipStatus, string | undefined>>
  children: ReactNode
  showIcon?: boolean
}

const variantIcon: Record<TooltipVariant, ReactNode> = {
  'info': <IconInfo />,
  'success': <IconCheckCircle style={{color: 'var(--color-success)'}}/>,
  'warning': <IconWarning style={{color: 'var(--color-warning)'}}/>,
  'error': <IconXCircle style={{color: 'var(--color-danger)'}}/>
}

export function Tooltip({ variant, status, message, children, showIcon = true }: TooltipProps) {
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

  return (
    <div className={styles.wrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {visible && (
        <div className={`${styles.bubble} ${styles[resolvedVariant]}`}>
          {showIcon && variantIcon[resolvedVariant]}
          {typeof message === 'string' ? message : message[status!]}
        </div>
      )}
    </div>
  )
}