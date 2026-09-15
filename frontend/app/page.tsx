'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { GridWarp } from '@/components/home/GridWarp'

export default function HomePage() {
  const router = useRouter()

  return (
    <main>
      {/*
        dvh, not vh (h-screen): on iOS Chrome and Safari 100vh is the *large*
        viewport — the height the page would have if the URL bar were
        retracted — so a 100vh hero runs taller than what's actually on screen
        and pushes the bottom-anchored nav island below the fold. 100dvh
        tracks the bar, and since the hero is exactly one viewport tall there's
        nothing to scroll, so the bar never retracts and the value stays put.
      */}
      <section
        className="relative h-dvh flex flex-col items-center justify-center overflow-hidden"
        style={{ background: 'var(--color-bg)' }}
      >
        <GridWarp />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 90% 80% at 50% 50%, var(--color-bg) 0%, var(--color-bg) 35%, transparent 85%)',
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-6 text-center px-6">
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            // 80px floor never let the wordmark scale below a 500px-wide
            // viewport; 56px lets it keep shrinking down to a small phone.
            fontSize: 'clamp(56px, 16vw, 172px)',
            fontWeight: 400,
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

        {/* Floating island nav */}
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20"
          style={{ animation: 'fade-in 600ms ease 500ms forwards', opacity: 0 }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px',
            borderRadius: '999px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <Button variant="secondary" size="md" onClick={() => router.push('/sign-in')} style={{ borderRadius: '999px' }}>
              Sign in
            </Button>
            <Button variant="primary" size="md" onClick={() => router.push('/sign-up')} style={{ borderRadius: '999px' }}>
              Sign up
            </Button>
          </div>
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
      `}</style>
    </main>
  )
}
