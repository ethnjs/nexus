'use client'

import { Button } from "@/components/ui/Button"
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons"
import { Spinner } from "@/components/ui/Spinner"
import { ApiError, authApi } from "@/lib/api"
import { useAuth } from "@/lib/useAuth"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"


export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Spinner size='lg' />}>
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  // ── Verify Email states ──────────────────────────────────────────────────
  //  1  Loading
  //  2  Success
  //  3  Error
  // ────────────────────────────────────────────────────────────────────────
  const [state, setState] = useState<number>(1)
  const { user } = useAuth()
  const [sendEmailSuccess, setSendEmailSuccess] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [errors, setErrors] = useState<{
    verify?: string
    send?: string
  }>({})

  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  const router = useRouter()

  useEffect(() => {

    authApi.verifyEmail(token ?? '').then(() => setState(2)).catch(err => {
      const message = err instanceof ApiError ? err.message : "Something went wrong"
      setErrors({verify: message})
      setState(3)
    })
    
  }, [])

  return (
    <section style={{
      background: 'var(--color-surface)',
      padding: '100px 0',
      borderRadius: '10px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      maxWidth: 'min(420px, 90vw)',
      boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ marginBottom: '10px' }}>
        <h1 style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '48px',
          color: 'var(--color-text-primary)'
        }}>NEXUS</h1>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '28px',
          fontWeight: '700',
          color: 'var(--color-text-primary)'
        }}>Verify Your Email</h2>
      </div>

      {state === 1 && (
        <Spinner size='lg' />
      )}

      {state === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ marginBottom: '10px', display: 'flex', gap: '5px', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
              <IconCheckCircle style={{ color: 'var(--color-success)'}} size={16} />Email successfully verified.
          </span>
          {user ? (
            <Button onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
          ) : (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                You can close this window.
            </span>
          )}
        </div>
      )}

      {state === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <span style={{ marginBottom: '10px', alignItems: 'center', display: 'flex', gap: '6px', fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
              <IconXCircle style={{ color: 'var(--color-danger)'}} size={16} />Error: {errors.verify}
          </span>
          {user ? (
            <>
              <Button
                onClick={() => {
                  setLoading(true)
                  authApi.sendEmailVerification().then(() => setSendEmailSuccess(true)).catch(err => {
                    const message = err instanceof ApiError ? err.message : "Something went wrong"
                    setErrors({send: message})
                  }).finally(() => setLoading(false))
                }}
                loading={loading}
              >Resend Email</Button>
              {sendEmailSuccess && (
                <p style={{ marginTop: '5px', fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-success)' }}>
                  Email sent successfully. Please check your inbox.
                </p>
              )}
              {errors.send && (
                <p style={{ marginTop: '5px', fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)' }}>
                  {errors.send}
                </p>
              )}
            </>
          ) : (
            <Button onClick={() => router.push('/sign-in')}>Sign In to Resend Email</Button>
          )}
        </div>
      )}
    </section>
  )
}