'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ModalType = 'normal' | 'danger'

interface ModalProps {
  title?: string
  onClose: () => void
  children: ReactNode
  width?: number
  closeOnOverlayClick?: boolean
  type?: ModalType
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

  // Only close if both mousedown and mouseup landed on the overlay itself —
  // otherwise dragging a text selection from an input out past the modal
  // edge fires a click on the overlay and closes it mid-selection.
  const mouseDownOnOverlay = useRef(false)

  if (!mounted) return null

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { mouseDownOnOverlay.current = e.target === e.currentTarget }}
      onClick={(e) => {
        if (closeOnOverlayClick && mouseDownOnOverlay.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: type === 'danger' ? 'var(--color-danger-subtle)' : 'var(--color-surface)',
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