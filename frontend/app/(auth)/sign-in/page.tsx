'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, authApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'


export default function SignInPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const router = useRouter()

    async function handleSubmit(e: React.SyntheticEvent) {
        e.preventDefault()
        setLoading(true)
        setError('')
        
        try {
            await authApi.login(email, password)

            router.push('/dashboard')
        } catch (error: unknown) {
            if (error instanceof ApiError) {
                setError(error.message)
            } else {
                setError("Something went wrong :(")
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} noValidate>
            <h1 style={{ fontFamily: 'var(--font-serif)' }}>NEXUS</h1>
            <h2 style={{ fontFamily: 'var(--font-sans)' }}>Sign In</h2>
            <Input
                label="Email"
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                fullWidth
            />
            <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
            />
            <Button
                type="submit"
                loading={loading}
                fullWidth
            >Sign In</Button>

            <div>
                {error && (
                    <p style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: '14px',
                        color: 'var(--color-danger)'
                    }}>
                        {error}
                    </p>
                )}
            </div>
        </form>
    )
}

