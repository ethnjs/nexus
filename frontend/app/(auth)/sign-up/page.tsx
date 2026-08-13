'use client'

import { Suspense, useState } from "react"
import { authApi, ApiError } from "@/lib/api"
import { useRouter, useSearchParams } from "next/navigation"
import { IconCheckCircle } from "@/components/ui/Icons"
import { Button } from "@/components/ui/Button"
import { Modal } from "@/components/ui/Modal"
import { Spinner } from "@/components/ui/Spinner"
import { CredentialsForm } from "@/components/auth/CredentialsForm"
import { safeRedirectPath } from "@/lib/auth"

export default function SignUpPage() {
  return (
    <Suspense fallback={<Spinner size="lg" />}>
      <SignUpContent />
    </Suspense>
  )
}

function SignUpContent() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const [showVerifyModal, setShowVerifyModal] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = safeRedirectPath(searchParams.get('redirect'))
  const signInHref = redirect ? `/sign-in?redirect=${encodeURIComponent(redirect)}` : '/sign-in'
  const onboardingHref = redirect ? `/onboarding?redirect=${encodeURIComponent(redirect)}` : '/onboarding'

  async function handleRegister(password: string) {
    setLoading(true)
    setFormError(undefined)

    try {
      await authApi.register({ email, password })

      authApi.sendEmailVerification().catch(() => {}).finally(() => setShowVerifyModal(true))
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? error.message : "Something went wrong :(")
    } finally {
      setLoading(false)
    }
  }

  function VerifyModal() {
    return (
      <Modal onClose={() => {}}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <IconCheckCircle style={{ color: 'var(--color-success)', marginBottom: '20px' }} size={72} />
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', color: 'var(--color-text-primary)', marginBottom: '10px' }}>
            Your account was created successfully
          </h2>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', marginBottom: '10px' }}>We sent a verification link to {email}</p>
          <Button fullWidth onClick={() => { window.location.href = onboardingHref }}>Got it!</Button>
        </div>
      </Modal>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      {showVerifyModal && <VerifyModal />}

      <h2 style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '28px',
        fontWeight: '700',
        color: 'var(--color-text-primary)',
        margin: '0 0 30px',
        textAlign: 'center'
      }}>Sign Up</h2>

      <CredentialsForm
        email={email}
        onEmailChange={setEmail}
        onSubmit={handleRegister}
        submitLabel="Sign Up"
        loading={loading}
        formError={formError}
      />

      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          Already have an account?{' '}
        </span>
        <button onClick={() => router.push(signInHref)} className="link-subtle" style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600 }}>
          Sign in
        </button>
      </div>
    </div>
  )
}
