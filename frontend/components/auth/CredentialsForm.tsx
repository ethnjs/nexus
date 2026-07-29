'use client'

import { useState } from "react"
import { checkPassword, validateEmail, validatePassword, PasswordChecks } from "@/lib/auth"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { PasswordChecklist } from "@/components/auth/PasswordChecklist"

const EMPTY_CHECKS: PasswordChecks = {
  length: false, upper: false, lower: false, number: false, symbol: false, confirm: false,
}

interface CredentialsFormProps {
  // Omit both to render a password-only form (e.g. account-setup, where the
  // invited email isn't known client-side until after the token is submitted).
  email?:         string
  onEmailChange?: (value: string) => void
  onSubmit:       (password: string) => void | Promise<void>
  submitLabel:    string
  loading?:       boolean
  formError?:     string
}

// Shared email+password credentials form — sign-up's phase-1 fields,
// reused as-is by account-setup (password only, no email prop passed).
export function CredentialsForm({
  email, onEmailChange, onSubmit, submitLabel, loading = false, formError,
}: CredentialsFormProps) {
  const showEmail = email !== undefined && !!onEmailChange

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [checks, setChecks] = useState<PasswordChecks>(EMPTY_CHECKS)
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm_password?: string }>({})

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setErrors({})

    const nextErrors = {
      email: showEmail ? (validateEmail(email!) ?? undefined) : undefined,
      password: validatePassword(password) ?? undefined,
      confirm_password: password !== confirmPassword ? "Passwords don't match." : undefined,
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors)
      return
    }

    await onSubmit(password)
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
      {showEmail && (
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={e => { onEmailChange!(e.target.value); setErrors(er => ({ ...er, email: undefined })) }}
          autoComplete="email"
          error={errors.email}
          fullWidth
        />
      )}
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={e => {
          setPassword(e.target.value)
          setChecks(checkPassword(e.target.value, confirmPassword))
          setErrors(er => ({ ...er, password: undefined }))
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
              setConfirmPassword(e.target.value)
              setChecks(checkPassword(password, e.target.value))
              setErrors(er => ({ ...er, confirm_password: undefined }))
            }}
            autoComplete="new-password"
            error={errors.confirm_password}
            fullWidth
          />
          <PasswordChecklist checks={checks} />
        </>
      )}

      <Button type="submit" loading={loading} fullWidth>{submitLabel}</Button>

      <div>
        {formError && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)' }}>
            {formError}
          </p>
        )}
      </div>
    </form>
  )
}
