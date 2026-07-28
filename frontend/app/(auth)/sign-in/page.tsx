'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, authApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { IconArrowLeft } from '@/components/ui/Icons'
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
            <div style={{ marginBottom: '5px' }}>
                <button onClick={() => router.push('/')} className="link-subtle" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: 'var(--font-sans)'
                }}>
                    <IconArrowLeft/>Back to home
                </button>
            </div>

            <div style={{ marginBottom: '30px' }}>
                <h2 style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '28px',
                    fontWeight: '700',
                    color: 'var(--color-text-primary)'
                }}>Sign In</h2>
            </div>

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
        </div>
        
    )
}

