'use client'

import { useState } from "react"
import { ApiError, authApi } from "@/lib/api"
import { validateEmail } from "@/lib/auth"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Banner } from "@/components/ui/Banner"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const err = validateEmail(email)
    if (err) {
      setError(err)
      return
    }

    setError(undefined)
    setLoading(true)
    try {
      await authApi.requestPasswordReset(email)
      setSent(true)
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
          Reset your password
        </h2>
      </div>

      {sent ? (
        <Banner
          variant="success"
          message="If an account exists for that email, a reset link has been sent."
        />
      ) : (
        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }} noValidate>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(undefined) }}
            autoComplete="email"
            error={error}
            fullWidth
          />
          <Button type="submit" loading={loading} fullWidth>
            Send reset link
          </Button>
        </form>
      )}
    </>
  )
}
