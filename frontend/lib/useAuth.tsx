'use client'

import { useState, useEffect, createContext, useContext, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { authApi, usersApi, UserMeSlim, ApiError } from '@/lib/api'

// -------------------------------------------------------------------------
// Context
// -------------------------------------------------------------------------
interface AuthState {
  user:    UserMeSlim | null
  loading: boolean
  logout:  () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user:    null,
  loading: true,
  logout:  async () => {},
})

// Pages that require a logged-in user. Mirrors proxy.ts's PROTECTED_PREFIXES —
// an invalid-token 401 only needs a forced logout+redirect here; elsewhere
// (e.g. '/') a 401 just means "not logged in," which is expected.
const PROTECTED_PREFIXES = ['/dashboard']

// Routes reachable without a completed onboarding — public/pre-session pages
// plus onboarding itself. '/' and '/sign-in' aren't here — proxy.ts's
// AUTH_ROUTES already redirects an authenticated visit to those server-side.
// '/sign-up' still needs it: registration logs the user in without
// navigating away (the verify-email modal), which proxy.ts never sees.
// '/join' needs to show the invite (with a "finish onboarding first" prompt
// in place of the join button) rather than bouncing straight to /onboarding
// before the visitor ever sees it.
const ONBOARDING_EXEMPT_ROUTES = [
  '/sign-up', '/verify-email', '/forgot-password',
  '/reset-password', '/confirm-email-change', '/account-setup',
  '/revert-email-change', '/onboarding', '/join',
]

// -------------------------------------------------------------------------
// Provider — wrap the dashboard layout with this
// -------------------------------------------------------------------------
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<UserMeSlim | null>(null)
  const [loading, setLoading] = useState(true)
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Calls GET /users/me/ — returns current user or 401
    usersApi.me()
      .then(setUser)
      .catch((err: unknown) => {
        setUser(null)
        const onProtectedPage = PROTECTED_PREFIXES.some(p => window.location.pathname.startsWith(p))
        if (err instanceof ApiError && err.status === 401 && onProtectedPage) {
          // Cookie is present (middleware already checked that) but invalid —
          // clear it server-side and bounce back to sign-in.
          authApi.logout().finally(() => {
            window.location.href = '/'
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Re-checked on every route change (not just once on load) so navigating
  // client-side into a page after onboarding was left incomplete still redirects.
  useEffect(() => {
    if (loading || !user || user.is_onboarding_complete) return
    if (ONBOARDING_EXEMPT_ROUTES.includes(pathname)) return
    router.replace('/onboarding')
  }, [loading, user, pathname, router])

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      window.location.href = '/'
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// -------------------------------------------------------------------------
// Hook
// -------------------------------------------------------------------------
export function useAuth() {
  return useContext(AuthContext)
}