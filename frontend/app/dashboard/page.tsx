'use client'

import { useAuth } from '@/lib/useAuth'

export default function DashboardPage() {
  const { user, loading, logout } = useAuth()

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}>
        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize: '13px',
          color: 'var(--color-text-tertiary)',
        }}>
          Loading...
        </p>
      </div>
    )
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      flexDirection: 'column',
      gap: '24px',
    }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize: '11px',
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
          marginBottom: '12px',
        }}>
          Nexus
        </p>
        <h1 style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '40px',
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
          marginBottom: '8px',
        }}>
          Welcome, {user?.first_name ?? user?.email}
        </h1>
        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize: '14px',
          color: 'var(--color-text-secondary)',
        }}>
          Dashboard coming soon.
        </p>
      </div>

      <button
        onClick={logout}
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '13px',
          color: 'var(--color-text-tertiary)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
        }}
      >
        Sign out
      </button>
    </div>
  )
}