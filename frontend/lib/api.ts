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
  get:    <T>(path: string)                => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body }),
  patch:  <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string)                => request<T>(path, { method: 'DELETE' }),
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
  login: (email: string, password: string) =>
    api.post<AuthUser>('/auth/login', { email, password }),

  logout: () =>
    api.post<void>('/auth/logout', {}),

  me: () =>
    api.get<AuthUser>('/auth/me'),

  register: (body: { email: string; password: string; first_name?: string; last_name?: string; role?: string }) =>
    api.post<AuthUser>('/auth/register', body),
}

// -------------------------------------------------------------------------
// Tournaments
// -------------------------------------------------------------------------
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

export const tournamentsApi = {
  list:   ()                                      => api.get<Tournament[]>('/tournaments/'),
  get:    (id: number)                            => api.get<Tournament>(`/tournaments/${id}`),
  create: (body: Partial<Tournament>)             => api.post<Tournament>('/tournaments/', body),
  update: (id: number, body: Partial<Tournament>) => api.patch<Tournament>(`/tournaments/${id}`, body),
  delete: (id: number)                            => api.delete<void>(`/tournaments/${id}`),
}

// -------------------------------------------------------------------------
// Events
// -------------------------------------------------------------------------
export interface Event {
  id:                number
  tournament_id:     number
  name:              string
  division:          'B' | 'C'
  event_type:        'standard' | 'trial'
  category:          string | null
  building:          string | null
  room:              string | null
  floor:             string | null
  volunteers_needed: number
  blocks:            number[]   // block numbers
  created_at:        string
  updated_at:        string
}

export const eventsApi = {
  listByTournament: (tournamentId: number) =>
    api.get<Event[]>(`/events/tournament/${tournamentId}`),

  get: (id: number) =>
    api.get<Event>(`/events/${id}`),

  create: (body: Partial<Event>) =>
    api.post<Event>('/events/', body),

  update: (id: number, body: Partial<Event>) =>
    api.patch<Event>(`/events/${id}`, body),

  delete: (id: number) =>
    api.delete<void>(`/events/${id}`),
}

// -------------------------------------------------------------------------
// Users
// -------------------------------------------------------------------------
export interface User {
  id:                  number
  email:               string
  first_name:          string | null
  last_name:           string | null
  phone:               string | null
  shirt_size:          string | null
  dietary_restriction: string | null
  university:          string | null
  major:               string | null
  employer:            string | null
  role:                'admin' | 'td' | 'volunteer'
  is_active:           boolean
  created_at:          string
  updated_at:          string
}

export const usersApi = {
  list: () =>
    api.get<User[]>('/users/'),

  get: (id: number) =>
    api.get<User>(`/users/${id}`),

  getByEmail: (email: string) =>
    api.get<User>(`/users/by-email/${encodeURIComponent(email)}`),

  update: (id: number, body: Partial<User>) =>
    api.patch<User>(`/users/${id}`, body),

  delete: (id: number) =>
    api.delete<void>(`/users/${id}`),
}

// -------------------------------------------------------------------------
// Memberships
// -------------------------------------------------------------------------
export type MembershipStatus = 'interested' | 'confirmed' | 'declined' | 'assigned' | 'removed'

export interface AvailabilitySlot {
  date:  string   // YYYY-MM-DD
  start: string   // HH:MM
  end:   string   // HH:MM
}

export interface Membership {
  id:                         number
  user_id:                    number
  tournament_id:              number
  assigned_event_id:          number | null
  status:                     MembershipStatus
  roles:                      Record<string, number[]>
  role_preference:            string[]
  event_preference:           string[]
  general_volunteer_interest: string[]
  availability:               AvailabilitySlot[]
  lunch_order:                string | null
  notes:                      string | null
  extra_data:                 Record<string, unknown>
  created_at:                 string
  updated_at:                 string
  // joined fields (when API includes them)
  user?:                      User
}

export const membershipsApi = {
  listByTournament: (tournamentId: number, status?: MembershipStatus) =>
    api.get<Membership[]>(
      `/memberships/tournament/${tournamentId}${status ? `?status=${status}` : ''}`
    ),

  get: (id: number) =>
    api.get<Membership>(`/memberships/${id}`),

  create: (body: Partial<Membership>) =>
    api.post<Membership>('/memberships/', body),

  update: (id: number, body: Partial<Membership>) =>
    api.patch<Membership>(`/memberships/${id}`, body),

  delete: (id: number) =>
    api.delete<void>(`/memberships/${id}`),
}

// -------------------------------------------------------------------------
// Sheet Configs
// -------------------------------------------------------------------------
export type SheetType = 'interest' | 'confirmation' | 'events'

export interface ColumnMapping {
  field:      string
  type:       'string' | 'ignore' | 'boolean' | 'integer' | 'multi_select' | 'matrix_row' | 'category_events'
  row_key?:   string
  extra_key?: string
}

export interface SheetConfig {
  id:              number
  tournament_id:   number
  label:           string
  sheet_type:      SheetType
  sheet_url:       string
  spreadsheet_id:  string
  sheet_name:      string
  column_mappings: Record<string, ColumnMapping>
  is_active:       boolean
  last_synced_at:  string | null
  created_at:      string
  updated_at:      string
}

export interface SyncResult {
  created_users:       number
  updated_users:       number
  created_memberships: number
  updated_memberships: number
  errors:              string[]
}

export const sheetsApi = {
  validate: (sheet_url: string) =>
    api.post<{ spreadsheet_id: string; title: string }>('/sheets/validate', { sheet_url }),

  headers: (spreadsheet_id: string, sheet_name: string) =>
    api.post<{ headers: string[]; suggested_mappings: Record<string, ColumnMapping> }>(
      '/sheets/headers',
      { spreadsheet_id, sheet_name }
    ),

  listConfigs: (tournamentId: number) =>
    api.get<SheetConfig[]>(`/sheets/configs/tournament/${tournamentId}`),

  getConfig: (id: number) =>
    api.get<SheetConfig>(`/sheets/configs/${id}`),

  createConfig: (body: Partial<SheetConfig>) =>
    api.post<SheetConfig>('/sheets/configs', body),

  updateConfig: (id: number, body: Partial<SheetConfig>) =>
    api.patch<SheetConfig>(`/sheets/configs/${id}`, body),

  deleteConfig: (id: number) =>
    api.delete<void>(`/sheets/configs/${id}`),

  sync: (configId: number) =>
    api.post<SyncResult>(`/sheets/configs/${configId}/sync`, {}),
}