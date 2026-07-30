'use client'

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ApiError, authApi } from "@/lib/api"
import { useAuth } from "@/lib/useAuth"
import { Button } from "@/components/ui/Button"
import { Spinner } from "@/components/ui/Spinner"
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons"

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={<Spinner size='lg' />}>
      <ConfirmEmailChangeContent />
    </Suspense>
  )
}

function ConfirmEmailChangeContent() {
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const { user } = useAuth()
  const router = useRouter()

  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  useEffect(() => {
    authApi.confirmEmailChange(token ?? '').then(() => setState('success')).catch(err => {
      setError(err instanceof ApiError ? err.message : "Something went wrong")
      setState('error')
    })
  }, [])

  return (
    <>
      <div style={{ marginBottom: '30px' }}>
        <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: '28px', fontWeight: '700', color: 'var(--color-text-primary)' }}>
          Confirm Email Change
        </h2>
      </div>

      {state === 'loading' && (
        <Spinner size='lg' />
      )}

      {state === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ marginBottom: '10px', display: 'flex', gap: '5px', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
            <IconCheckCircle style={{ color: 'var(--color-success)' }} size={16} />Your email has been updated.
          </span>
          {user ? (
            <Button onClick={() => router.push('/settings/account')}>Back to account settings</Button>
          ) : (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              You can close this window.
            </span>
          )}
        </div>
      )}

      {state === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ marginBottom: '10px', alignItems: 'center', display: 'flex', gap: '6px', fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
            <IconXCircle style={{ color: 'var(--color-danger)' }} size={16} />Error: {error}
          </span>
          {user && (
            <Button onClick={() => router.push('/settings/account')}>Back to account settings</Button>
          )}
        </div>
      )}
    </>
  )
}
