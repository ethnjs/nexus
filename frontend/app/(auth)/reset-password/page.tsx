'use client'

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ApiError, authApi } from "@/lib/api"
import { checkPassword, validatePassword, PasswordChecks } from "@/lib/auth"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Spinner } from "@/components/ui/Spinner"
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons"
import { PasswordChecklist } from "@/components/settings/PasswordChecklist"

const EMPTY_CHECKS: PasswordChecks = {
  length: false, upper: false, lower: false, number: false, symbol: false, confirm: false,
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Spinner size='lg' />}>
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ''
  const router = useRouter()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [checks, setChecks] = useState<PasswordChecks>(EMPTY_CHECKS)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const passwordErr = validatePassword(newPassword)
    if (passwordErr) {
      setError(passwordErr)
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }

    setError(undefined)
    setLoading(true)
    try {
      await authApi.confirmPasswordReset(token, newPassword)
      setSuccess(true)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div style={{ marginBottom: '30px' }}>
        <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: '28px', fontWeight: '700', color: 'var(--color-text-primary)' }}>
          Set a new password
        </h2>
      </div>

      {success ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ marginBottom: '16px', display: 'flex', gap: '5px', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--color-text-primary)' }}>
            <IconCheckCircle style={{ color: 'var(--color-success)' }} size={16} />Password successfully reset.
          </span>
          <Button onClick={() => router.push('/sign-in')}>Sign in</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }} noValidate>
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={e => {
              setNewPassword(e.target.value)
              setChecks(checkPassword(e.target.value, confirmPassword))
              setError(undefined)
            }}
            autoComplete="new-password"
            fullWidth
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={e => {
              setConfirmPassword(e.target.value)
              setChecks(checkPassword(newPassword, e.target.value))
              setError(undefined)
            }}
            autoComplete="new-password"
            fullWidth
          />
          <PasswordChecklist checks={checks} />
          {error && (
            <span style={{ display: 'flex', gap: '6px', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)' }}>
              <IconXCircle size={14} />{error}
            </span>
          )}
          <Button type="submit" loading={loading} fullWidth>
            Reset password
          </Button>
        </form>
      )}
    </>
  )
}
