import { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
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
                <div style={{ marginBottom: '10px' }}>
                    <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '48px', color: 'var(--color-text-primary)' }}>NEXUS</h1>
                </div>
                {children}
            </section>
        </div>
    )
}
