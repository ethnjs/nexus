'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { IconArrowDown } from '@/components/ui/Icons'
import { ApiError } from '@/lib/api'

export default function HomePage() {
  const [loginVisible, setLoginVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setLoginVisible(window.scrollY > window.innerHeight * 0.3)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <main>

      {/* ----------------------------------------------------------------
          Hero — full viewport
      ---------------------------------------------------------------- */}
      <section
        className="relative h-screen flex flex-col items-center justify-center overflow-hidden"
        style={{ background: 'var(--color-bg)' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(var(--color-border) 1px, transparent 1px),
              linear-gradient(90deg, var(--color-border) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
            opacity: 0.5,
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, var(--color-bg) 100%)',
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-6 text-center px-6">
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(80px, 16vw, 172px)',
            letterSpacing: '-0.03em',
            lineHeight: 1,
            color: 'var(--color-text-primary)',
            animation: 'fade-up 600ms ease 100ms forwards',
            opacity: 0,
          }}>
            NEXUS
          </h1>

          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '16px',
            fontWeight: 400,
            letterSpacing: '0.01em',
            color: 'var(--color-text-secondary)',
            animation: 'fade-up 600ms ease 300ms forwards',
            opacity: 0,
          }}>
            Tournament Logistics Dashboard for Science Olympiad
          </p>
        </div>

        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
          style={{ animation: 'fade-in 600ms ease 900ms forwards', opacity: 0 }}
        >
          <IconArrowDown
            size={22}
            style={{
              animation: 'arrow-bounce 2s ease-in-out infinite',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </div>
      </section>

      {/* ----------------------------------------------------------------
          Login section
      ---------------------------------------------------------------- */}
      <section
        className="h-screen flex items-center justify-center px-6"
        style={{ background: 'var(--color-bg)' }}
      >
        <div style={{
          width: '100%',
          maxWidth: '420px',
          opacity: loginVisible ? 1 : 0,
          transform: loginVisible ? 'translateY(0)' : 'translateY(24px)',
          transition: 'opacity 450ms ease, transform 450ms ease',
        }}>
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '34px',
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              color: 'var(--color-text-primary)',
            }}>
              Sign in to your<br />dashboard
            </h2>
          </div>

          <LoginForm />
        </div>
      </section>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes arrow-bounce {
          0%, 100% { transform: translateY(0);   opacity: 0.4; }
          50%       { transform: translateY(6px); opacity: 1;   }
        }
        input::placeholder { color: var(--color-text-tertiary); }
      `}</style>
    </main>
  )
}

function LoginForm() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [errors, setErrors]     = useState<{ email?: string; password?: string; form?: string }>({})

  function validate() {
    const e: typeof errors = {}
    if (!email.trim())    e.email    = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email'
    if (!password.trim()) e.password = 'Password is required'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validation = validate()
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      return
    }
    setErrors({})
    setLoading(true)
    try {
      const { authApi } = await import('@/lib/api')
      await authApi.login(email, password)
      window.location.href = '/dashboard'
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        setErrors({ form: 'Invalid email or password' })
      } else {
        setErrors({ form: 'Something went wrong — please try again' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <Input
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={e => { setEmail(e.target.value); setErrors(ev => ({ ...ev, email: undefined })) }}
        autoComplete="email"
        error={errors.email}
        fullWidth
      />
      <Input
        label="Password"
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={e => { setPassword(e.target.value); setErrors(ev => ({ ...ev, password: undefined })) }}
        autoComplete="current-password"
        error={errors.password}
        fullWidth
      />

      <div style={{ minHeight: '20px' }}>
        {errors.form && (
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            color: 'var(--color-danger)',
          }}>
            {errors.form}
          </p>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={loading}
        fullWidth
      >
        Sign in
      </Button>
    </form>
  )
}