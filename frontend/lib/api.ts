const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  method?:  HttpMethod
  body?:    unknown
  headers?: Record<string, string>
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',  // send JWT cookie cross-origin
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail ?? detail
    } catch {}
    throw new ApiError(res.status, detail)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json()
}

// Convenience methods
export const api = {
  get:    <T>(path: string)                      => request<T>(path),
  post:   <T>(path: string, body: unknown)       => request<T>(path, { method: 'POST',  body }),
  patch:  <T>(path: string, body: unknown)       => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string)                      => request<T>(path, { method: 'DELETE' }),
}

// -------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------
export interface AuthUser {
  id:         number
  email:      string
  first_name: string | null
  last_name:  string | null
  role:       'admin' | 'td' | 'volunteer'
  is_active:  boolean
  created_at: string
}

export const authApi = {
  login:    (email: string, password: string) =>
    api.post<AuthUser>('/api/v1/auth/login', { email, password }),

  logout:   () =>
    api.post<void>('/api/v1/auth/logout', {}),

  me:       () =>
    api.get<AuthUser>('/api/v1/auth/me'),

  register: (body: { email: string; password: string; first_name?: string; last_name?: string; role?: string }) =>
    api.post<AuthUser>('/api/v1/auth/register', body),
}

// -------------------------------------------------------------------------
// Tournaments
// -------------------------------------------------------------------------
export interface Tournament {
  id:               number
  name:             string
  start_date:       string | null
  end_date:         string | null
  location:         string | null
  blocks:           TournamentBlock[]
  volunteer_schema: { custom_fields: CustomField[] }
  owner_id:         number
  created_at:       string
  updated_at:       string
}

export interface TournamentBlock {
  number: number
  label:  string
  date:   string   // YYYY-MM-DD
  start:  string   // HH:MM
  end:    string   // HH:MM
}

export interface CustomField {
  key:   string
  label: string
  type:  string
}

export const tournamentsApi = {
  list:   ()                                    => api.get<Tournament[]>('/api/v1/tournaments/'),
  get:    (id: number)                          => api.get<Tournament>(`/api/v1/tournaments/${id}`),
  create: (body: Partial<Tournament>)           => api.post<Tournament>('/api/v1/tournaments/', body),
  update: (id: number, body: Partial<Tournament>) => api.patch<Tournament>(`/api/v1/tournaments/${id}`, body),
  delete: (id: number)                          => api.delete<void>(`/api/v1/tournaments/${id}`),
}