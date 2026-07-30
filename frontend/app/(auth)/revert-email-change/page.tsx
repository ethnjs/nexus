'use client'

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authApi, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/Button"
import { Spinner } from "@/components/ui/Spinner"
import { IconCheckCircle } from "@/components/ui/Icons"
import { CredentialsForm } from "@/components/auth/CredentialsForm"

export default function RevertEmailChangePage() {
  return (
    <Suspense fallback={<Spinner size='lg' />}>
      <RevertEmailChangeContent />
    </Suspense>
  )
}

function RevertEmailChangeContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ''
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const [success, setSuccess] = useState(false)

  async function handleRevert(password: string) {
    setLoading(true)
    setFormError(undefined)

    try {
      await authApi.revertEmailChange(token, password)
      // Backend has already revoked every session — no cookie to refresh
      // into, so this is a plain success state, not a redirect.
      setSuccess(true)
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? error.message : "Something went wrong :(")
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)', textAlign: 'center' }}>
        This link is missing or invalid.
      </p>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <h2 style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '28px',
        fontWeight: '700',
        color: 'var(--color-text-primary)',
        margin: '0 0 10px',
        textAlign: 'center'
      }}>Secure your account</h2>

      {!success && (
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '14px',
          color: 'var(--color-text-secondary)',
          margin: '0 0 30px',
          textAlign: 'center'
        }}>Choose a new password to undo the email change and secure your account.</p>
      )}

      {success ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ marginBottom: '16px', display: 'flex', gap: '5px', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
            <IconCheckCircle style={{ color: 'var(--color-success)' }} size={16} />Your account has been secured.
          </span>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-text-secondary)', textAlign: 'center', marginBottom: '20px' }}>
            The email change was reverted and every session was signed out. Please sign in again.
          </p>
          <Button onClick={() => router.push('/sign-in')}>Sign in</Button>
        </div>
      ) : (
        <CredentialsForm
          onSubmit={handleRevert}
          submitLabel="Secure account"
          loading={loading}
          formError={formError}
        />
      )}
    </div>
  )
}
