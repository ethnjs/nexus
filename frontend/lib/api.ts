// In dev:  NEXT_PUBLIC_API_URL=http://localhost:8001 → hits backend directly
// In prod: NEXT_PUBLIC_API_URL is unset → goes through /api/proxy → Next.js adds API key server-side
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/proxy'

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
    credentials: 'include',
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

  if (res.status === 204) return undefined as T

  return res.json()
}

// Convenience methods
export const api = {
  get:    <T>(path: string)                => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body }),
  patch:  <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string)               => request<T>(path, { method: 'DELETE' }),
}

// -------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------
export interface AuthUser {
  id:         number
  email:      string
  first_name: string | null
  last_name:  string | null
  role:       'admin' | 'user'   // "td" and "volunteer" no longer exist
  is_active:  boolean
  created_at: string
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthUser>('/auth/login/', { email, password }),

  logout: () =>
    api.post<void>('/auth/logout/', {}),

  me: () =>
    api.get<AuthUser>('/auth/me/'),

  register: (body: { email: string; password: string; first_name?: string; last_name?: string }) =>
    api.post<AuthUser>('/auth/register/', body),
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

export interface PositionDefinition {
  key:         string
  label:       string
  permissions: string[]
}

export interface VolunteerSchema {
  custom_fields: CustomField[]
  positions:     PositionDefinition[]
}

export interface Tournament {
  id:               number
  name:             string
  start_date:       string | null
  end_date:         string | null
  location:         string | null
  blocks:           TournamentBlock[]
  volunteer_schema: VolunteerSchema
  owner_id:         number
  created_at:       string
  updated_at:       string
}

export const tournamentsApi = {
  // GET /tournaments/me/ — returns tournaments the current user has a membership in
  // (admin sees all; regular users see only their own)
  list:   ()                                      => api.get<Tournament[]>('/tournaments/me/'),

  // GET /tournaments/ — admin only, returns ALL tournaments
  listAll: ()                                     => api.get<Tournament[]>('/tournaments/'),

  get:    (id: number)                            => api.get<Tournament>(`/tournaments/${id}/`),
  create: (body: Partial<Tournament>)             => api.post<Tournament>('/tournaments/', body),
  update: (id: number, body: Partial<Tournament>) => api.patch<Tournament>(`/tournaments/${id}/`, body),
  delete: (id: number)                            => api.delete<void>(`/tournaments/${id}/`),
}

// -------------------------------------------------------------------------
// Events — nested under /tournaments/{id}/events/
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
  blocks:            number[]
  created_at:        string
  updated_at:        string
}

export const eventsApi = {
  listByTournament: (tournamentId: number) =>
    api.get<Event[]>(`/tournaments/${tournamentId}/events/`),
  get:    (tournamentId: number, id: number) =>
    api.get<Event>(`/tournaments/${tournamentId}/events/${id}/`),
  create: (tournamentId: number, body: Partial<Event>) =>
    api.post<Event>(`/tournaments/${tournamentId}/events/`, body),
  update: (tournamentId: number, id: number, body: Partial<Event>) =>
    api.patch<Event>(`/tournaments/${tournamentId}/events/${id}/`, body),
  delete: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/events/${id}/`),
}

// -------------------------------------------------------------------------
// Users — /users/ routes are admin-only
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
  role:                'admin' | 'user'
  is_active:           boolean
  created_at:          string
  updated_at:          string
}

export const usersApi = {
  // Admin-only global routes
  list:       ()                                 => api.get<User[]>('/users/'),
  get:        (id: number)                       => api.get<User>(`/users/${id}/`),
  getByEmail: (email: string)                    => api.get<User>(`/users/by-email/${encodeURIComponent(email)}/`),
  update:     (id: number, body: Partial<User>)  => api.patch<User>(`/users/${id}/`, body),
  delete:     (id: number)                       => api.delete<void>(`/users/${id}/`),

  // Tournament-scoped — requires manage_volunteers or manage_tournament
  getForTournament: (tournamentId: number, userId: number) =>
    api.get<User>(`/tournaments/${tournamentId}/users/${userId}/`),
}

// -------------------------------------------------------------------------
// Memberships — nested under /tournaments/{id}/memberships/
// -------------------------------------------------------------------------
export type MembershipStatus = 'interested' | 'confirmed' | 'declined' | 'assigned' | 'removed'

export interface AvailabilitySlot {
  date:  string
  start: string
  end:   string
}

export interface ScheduleSlot {
  block: number   // block number
  duty:  string   // position key or free string, e.g. "event_supervisor"
}

export interface Membership {
  id:                number
  user_id:           number
  tournament_id:     number
  assigned_event_id: number | null

  // Position keys from tournament.volunteer_schema["positions"]
  // Drives title + system permissions within this tournament
  positions:         string[] | null

  // Day-of block schedule — [{block: int, duty: str}, ...]
  schedule:          ScheduleSlot[] | null

  status:            MembershipStatus
  role_preference:   string[] | null
  event_preference:  string[] | null
  availability:      AvailabilitySlot[] | null
  lunch_order:       string | null
  notes:             string | null

  // All tournament-specific arbitrary data lives here
  // e.g. { transportation, general_volunteer_interest, carpool_seats, ... }
  extra_data:        Record<string, unknown> | null

  created_at:        string
  updated_at:        string
  user?:             User
}

export const membershipsApi = {
  listByTournament: (tournamentId: number, status?: MembershipStatus) =>
    api.get<Membership[]>(
      `/tournaments/${tournamentId}/memberships/${status ? `?status=${status}` : ''}`
    ),
  get:    (tournamentId: number, id: number) =>
    api.get<Membership>(`/tournaments/${tournamentId}/memberships/${id}/`),
  create: (tournamentId: number, body: Partial<Membership>) =>
    api.post<Membership>(`/tournaments/${tournamentId}/memberships/`, body),
  update: (tournamentId: number, id: number, body: Partial<Membership>) =>
    api.patch<Membership>(`/tournaments/${tournamentId}/memberships/${id}/`, body),
  delete: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/memberships/${id}/`),
}

// -------------------------------------------------------------------------
// Sheet Configs — nested under /tournaments/{id}/sheets/
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
  created:        number
  updated:        number
  skipped:        number
  errors:         Array<{ row: number; email: string | null; detail: string }>
  last_synced_at: string
}

export const sheetsApi = {
  validate: (tournamentId: number, sheet_url: string) =>
    api.post<{ spreadsheet_id: string; spreadsheet_title: string; sheet_names: string[] }>(
      `/tournaments/${tournamentId}/sheets/validate/`, { sheet_url }
    ),
  headers: (tournamentId: number, sheet_url: string, sheet_name: string) =>
    api.post<{ sheet_name: string; headers: string[]; suggestions: Record<string, ColumnMapping>; known_fields: string[]; valid_types: string[] }>(
      `/tournaments/${tournamentId}/sheets/headers/`, { sheet_url, sheet_name }
    ),
  listConfigs:  (tournamentId: number) =>
    api.get<SheetConfig[]>(`/tournaments/${tournamentId}/sheets/configs/`),
  getConfig:    (tournamentId: number, id: number) =>
    api.get<SheetConfig>(`/tournaments/${tournamentId}/sheets/configs/${id}/`),
  createConfig: (tournamentId: number, body: Partial<SheetConfig>) =>
    api.post<SheetConfig>(`/tournaments/${tournamentId}/sheets/configs/`, body),
  updateConfig: (tournamentId: number, id: number, body: Partial<SheetConfig>) =>
    api.patch<SheetConfig>(`/tournaments/${tournamentId}/sheets/configs/${id}/`, body),
  deleteConfig: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/sheets/configs/${id}/`),
  sync:         (tournamentId: number, configId: number) =>
    api.post<SyncResult>(`/tournaments/${tournamentId}/sheets/configs/${configId}/sync/`, {}),
}