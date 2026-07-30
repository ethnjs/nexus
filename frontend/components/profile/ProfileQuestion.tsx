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
  const showActions = isActive && (showSkip || showNext)

  return (
    <div>
      <label style={{
        display: 'block', marginBottom: '10px',
        fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600,
        color: 'var(--color-text-secondary)',
      }}>
        {question}
      </label>

      {children}

      {showActions && (
        <div style={{
          marginTop: '14px',
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
        }}>
          {showSkip && (
            <Button type="button" variant="secondary" onClick={onSkip}>Skip</Button>
          )}
          {showNext && (
            <Button type="button" variant="primary" onClick={onNext}>Next</Button>
          )}
        </div>
      )}
    </div>
  )
}