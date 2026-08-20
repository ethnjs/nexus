'use client'

import { ReactNode, useEffect, useState } from 'react'

interface FadeInProps {
  children: ReactNode
  /** ms for the fade/slide transition. */
  duration?: number
}

// Mount-triggered fade+slide-in — for content that swaps in via conditional
// rendering (a different subtree, not a persisted DOM node), so a plain CSS
// transition on a prop change has nothing to animate from. Starts hidden,
// flips to visible a couple frames after mount so the browser has actually
// painted the 0-opacity state first and there's a real transition to see
// (same double-rAF technique as LayoutPanelSlot in the dashboard layout).
export function FadeIn({ children, duration = 150 }: FadeInProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true))
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [])

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(-4px)',
      transition: `opacity ${duration}ms ease, transform ${duration}ms ease`,
    }}>
      {children}
    </div>
  )
}
