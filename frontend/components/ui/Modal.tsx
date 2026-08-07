'use client'

import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ModalType = 'normal' | 'danger'

interface ModalProps {
  title?: string
  onClose: () => void
  children: ReactNode
  width?: number
  closeOnOverlayClick?: boolean
  type?: ModalType
  /** Merged onto the panel's own style — e.g. maxHeight + display: 'flex',
   * flexDirection: 'column' so a child can scroll internally via flex: 1,
   * overflowY: 'auto' instead of the panel growing past the viewport. */
  contentStyle?: React.CSSProperties
}

export function Modal({ title, onClose, children, width = 440, closeOnOverlayClick = true, type = 'normal', contentStyle }: ModalProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: type === 'danger' ? '2px solid var(--color-danger)' : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px',
          width,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: 'var(--shadow-lg)',
          ...contentStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '22px',
            color: type === 'danger' ? 'var(--color-danger)' : 'var(--color-text-primary)',
            marginBottom: '20px',
            flexShrink: 0,
          }}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}