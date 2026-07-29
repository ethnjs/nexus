'use client'

import { useState } from "react"
import { authApi, ApiError } from "@/lib/api"
import { useRouter } from "next/navigation"
import { checkPassword, validateEmail, validatePassword, PasswordChecks } from "@/lib/auth"
import { IconCheckCircle } from "@/components/ui/Icons"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Modal } from "@/components/ui/Modal"
import { PasswordChecklist } from "@/components/settings/PasswordChecklist"

const EMPTY_CHECKS: PasswordChecks = {
  length: false, upper: false, lower: false, number: false, symbol: false, confirm: false,
}

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [checks, setChecks] = useState<PasswordChecks>(EMPTY_CHECKS)
  const [loading, setLoading] = useState(false)
  const [showVerifyModal, setShowVerifyModal] = useState(false)

  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirm_password?: string
    form?: string
  }>({})

  const router = useRouter()

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setLoading(true)
    setErrors({})

    const registerErrors = {
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined,
      confirm_password: password !== confirmPassword ? "Passwords don't match." : undefined
    }

    if (Object.values(registerErrors).some(v => v)) {
      setErrors(registerErrors)
      setLoading(false)
      return
    }

    try {
      await authApi.register({ email, password })

      authApi.sendEmailVerification().catch(() => {}).finally(() => setShowVerifyModal(true))
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrors({ form: error.message })
      } else {
        setErrors({ form: "Something went wrong :(" })
      }
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
          <Button fullWidth onClick={() => { window.location.href = "/onboarding" }}>Got it!</Button>
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

      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setErrors(er => ({ ...er, email: undefined })) }}
          autoComplete="email"
          error={errors.email}
          fullWidth
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={e => {
            setPassword(e.target.value);
            setChecks(checkPassword(e.target.value, confirmPassword))
            setErrors(er => ({ ...er, password: undefined }));
          }}
          autoComplete="new-password"
          error={errors.password}
          fullWidth
        />

        {password && (
          <>
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={e => {
                setConfirmPassword(e.target.value);
                setChecks(checkPassword(password, e.target.value))
                setErrors(er => ({ ...er, confirm_password: undefined }));
              }}
              autoComplete="new-password"
              error={errors.confirm_password}
              fullWidth
            />
            <PasswordChecklist checks={checks} />
          </>
        )}

        <Button
          type="submit"
          loading={loading}
          fullWidth
        >Sign Up</Button>

        <div>
          {errors.form && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)' }}>
              {errors.form}
            </p>
          )}
        </div>
      </form>

      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          Already have an account?{' '}
        </span>
        <button onClick={() => router.push('/sign-in')} className="link-subtle" style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600 }}>
          Sign in
        </button>
      </div>
    </div>
  )
}
