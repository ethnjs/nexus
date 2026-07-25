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
        if (err instanceof ApiError && err.status === 401) {
          setUser(null)
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