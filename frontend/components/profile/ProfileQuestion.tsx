'use client'

import { Button } from "@/components/ui/Button"

interface ProfileQuestionProps {
  question: string
  children: React.ReactNode
  onSkip?: () => void
  onNext?: () => void
  isActive?: boolean
}

export function ProfileQuestion({
  question,
  children,
  onSkip = undefined,
  onNext = undefined,
  isActive = false
}: ProfileQuestionProps) {
  const showSkip = !!onSkip
  const showNext = !!onNext
  return (
    <div style={{marginBottom: '20px'}}>
      <p style={{ marginBottom: '5px', fontFamily: 'var(--font-sans)', fontSize: '18px', color: 'var(--color-text-primary)' }}>{question}</p>
      {children}
      {isActive && (showSkip || showNext) && (
        <div style={{marginTop: '10px', justifyContent:'right', display: 'flex', gap: '5px'}}>
          {showSkip && (<Button
            type="button"
            variant="secondary"
            onClick={onSkip}
          >Skip</Button>)}
          {showNext && (<Button
            type="button"
            variant="primary"
            onClick={onNext}
          >Next</Button>)}
        </div>
      )}
    </div>
  )
}