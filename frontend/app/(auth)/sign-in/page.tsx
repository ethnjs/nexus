'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, authApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { IconArrowLeft } from '@/components/ui/Icons'


export default function SignInPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})

    const router = useRouter()

    function validateEmail(email: string): string | null {
        if (!email.includes('@')) return "An email address must have an @-sign."
        const atLoc = email.indexOf('@')
        if (atLoc === email.length - 1) return "There must be something after the @-sign."
        if (!email.includes('.', atLoc)) return "The part after the @-sign is not valid. It should have a period."
        if (email.indexOf('.', atLoc) === email.length - 1) return "An email address cannot end with a period."
        return null
    }

    async function handleSubmit(e: React.SyntheticEvent) {
        e.preventDefault()
        setLoading(true)
        setErrors({})

        const emailError = validateEmail(email)
        const passwordError = !password ? "Password is empty." : null

        if (emailError || passwordError) {
            setErrors({ email: emailError ?? undefined, password: passwordError ?? undefined })
            setLoading(false)
            return
        }
        
        try {
            await authApi.login(email, password)

            router.push('/dashboard')
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
        <section style={{ maxWidth: '420px', width: '100%' }}>
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
            
            <div style={{ marginBottom: '10px' }}>
                <h1 style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '48px',
                    color: 'var(--color-text-primary)'
                }}>NEXUS</h1>
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
        </section>
        
    )
}

