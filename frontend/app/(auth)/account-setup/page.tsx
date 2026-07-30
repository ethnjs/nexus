'use client'

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { authApi, ApiError } from "@/lib/api"
import { Spinner } from "@/components/ui/Spinner"
import { CredentialsForm } from "@/components/auth/CredentialsForm"

export default function AccountSetupPage() {
  return (
    <Suspense fallback={<Spinner size='lg' />}>
      <AccountSetupContent />
    </Suspense>
  )
}

function AccountSetupContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ''

  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(undefined)

  async function handleConfirm(password: string) {
    setLoading(true)
    setFormError(undefined)

    try {
      await authApi.confirmAccountSetup(token, password)

      // Full reload (not router.push) — AuthProvider needs to fetch the
      // now-authenticated session fresh, same reasoning as onboarding/sign-up.
      window.location.href = "/onboarding"
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? error.message : "Something went wrong :(")
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)', textAlign: 'center' }}>
        This link is missing or invalid. Ask whoever invited you to resend it.
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
      }}>Set up your account</h2>

      <p style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '14px',
        color: 'var(--color-text-secondary)',
        margin: '0 0 30px',
        textAlign: 'center'
      }}>Choose a password to finish setting up your account.</p>

      <CredentialsForm
        onSubmit={handleConfirm}
        submitLabel="Complete setup"
        loading={loading}
        formError={formError}
      />
    </div>
  )
}
