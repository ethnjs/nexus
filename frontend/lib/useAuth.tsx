'use client'

import { useState, useEffect, createContext, useContext, ReactNode } from 'react'
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

// -------------------------------------------------------------------------
// Provider — wrap the dashboard layout with this
// -------------------------------------------------------------------------
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<UserMeSlim | null>(null)
  const [loading, setLoading] = useState(true)

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