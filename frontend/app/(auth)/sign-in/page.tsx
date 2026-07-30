'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, authApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { validateEmail } from '@/lib/auth'


export default function SignInPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})

    const router = useRouter()

    async function handleSubmit(e: React.SyntheticEvent) {
        e.preventDefault()
        setLoading(true)
        setErrors({})

        const emailError = validateEmail(email)
        const passwordError = !password ? "Cannot be empty." : null

        if (emailError || passwordError) {
            setErrors({ email: emailError ?? undefined, password: passwordError ?? undefined })
            setLoading(false)
            return
        }
        
        try {
            await authApi.login(email, password)

            window.location.href = '/dashboard'
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

    return (
        <div style={{ width: '100%' }}>
            <h2 style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '28px',
                fontWeight: '700',
                color: 'var(--color-text-primary)',
                margin: '0 0 30px',
                textAlign: 'center'
            }}>Sign In</h2>

            <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <Input
                    label="Email"
                    type="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setErrors(er => ({...er, email: undefined })) }}
                    autoComplete="email"
                    error={errors.email}
                    fullWidth
                />
                <div>
                    <Input
                        label="Password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => { setPassword(e.target.value); setErrors(er => ({...er, password: undefined})) }}
                        autoComplete="current-password"
                        error={errors.password}
                        fullWidth
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                        <button type="button" onClick={() => router.push('/forgot-password')} className="link-subtle" style={{
                            fontFamily: 'var(--font-sans)',
                            fontSize: '13px',
                        }}>
                            Forgot password?
                        </button>
                    </div>
                </div>
                <Button
                    type="submit"
                    loading={loading}
                    fullWidth
                >Sign In</Button>

                <div>
                    {errors.form && (
                        <p style={{
                            fontFamily: 'var(--font-sans)',
                            fontSize: '14px',
                            color: 'var(--color-danger)'
                        }}>
                            {errors.form}
                        </p>
                    )}
                </div>
            </form>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                    Don&rsquo;t have an account?{' '}
                </span>
                <button onClick={() => router.push('/sign-up')} className="link-subtle" style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600 }}>
                    Sign up
                </button>
            </div>
        </div>

    )
}

