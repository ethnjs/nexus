'use client'

import { ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconArrowLeft } from '@/components/ui/Icons'

// Pages that show a "Back to home" link above the wordmark.
const BACK_TO_HOME_ROUTES = ['/sign-in', '/sign-up']

export default function AuthLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()

    return (
        <div className="min-h-screen flex items-center justify-center py-16 px-4">
            <section style={{
                background: 'var(--color-surface)',
                padding: '60px 40px',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                maxWidth: 'min(420px, 90vw)',
                boxShadow: 'var(--shadow-lg)',
            }}>
                {BACK_TO_HOME_ROUTES.includes(pathname) && (
                    <div style={{ width: '100%', marginBottom: '24px' }}>
                        <button onClick={() => router.push('/')} className="link-subtle" style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontFamily: 'var(--font-sans)'
                        }}>
                            <IconArrowLeft />Back to home
                        </button>
                    </div>
                )}
                <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '48px', color: 'var(--color-text-primary)', margin: '0 0 24px' }}>NEXUS</h1>
                {children}
            </section>
        </div>
    )
}
