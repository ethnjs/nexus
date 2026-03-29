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
  /** The raw `detail` value from the response body (may be a string or object). */
  detail: unknown
  constructor(public status: number, message: string, detail?: unknown) {
    super(message)
    this.name   = 'ApiError'
    this.detail = detail
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
    let detail: unknown = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail ?? detail
    } catch {}
    const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`
    throw new ApiError(res.status, message, detail)
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
  role:       'admin' | 'user'
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
  list:   ()                                      => api.get<Tournament[]>('/tournaments/me/'),
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
  student_status:      string | null
  competition_exp:     string | null
  volunteering_exp:    string | null
  role:                'admin' | 'user'
  is_active:           boolean
  created_at:          string
  updated_at:          string
}

export const usersApi = {
  list:       ()                                 => api.get<User[]>('/users/'),
  get:        (id: number)                       => api.get<User>(`/users/${id}/`),
  getByEmail: (email: string)                    => api.get<User>(`/users/by-email/${encodeURIComponent(email)}/`),
  update:     (id: number, body: Partial<User>)  => api.patch<User>(`/users/${id}/`, body),
  delete:     (id: number)                       => api.delete<void>(`/users/${id}/`),
  getForTournament: (tournamentId: number, userId: number) =>
    api.get<User>(`/tournaments/${tournamentId}/users/${userId}/`),
}

// -------------------------------------------------------------------------
// Memberships
// -------------------------------------------------------------------------
export type MembershipStatus = 'interested' | 'confirmed' | 'declined' | 'assigned' | 'removed'

export interface AvailabilitySlot {
  date:  string
  start: string
  end:   string
}

export interface ScheduleSlot {
  block: number
  duty:  string
}

export interface Membership {
  id:                number
  user_id:           number
  tournament_id:     number
  assigned_event_id: number | null
  positions:         string[] | null
  schedule:          ScheduleSlot[] | null
  status:            MembershipStatus
  role_preference:   string[] | null
  event_preference:  string[] | null
  availability:      AvailabilitySlot[] | null
  lunch_order:       Record<string, unknown> | string | null
  notes:             string | null
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
  deleteMembershipsByEmails: async (tournamentId: number, emails: string[]): Promise<{ deleted: number }> => {
    const emailSet = new Set(emails.map((e) => e.toLowerCase().trim()))
    const memberships = await api.get<Membership[]>(`/tournaments/${tournamentId}/memberships/`)
    const toDelete = memberships.filter(
      (m) => m.user?.email && emailSet.has(m.user.email.toLowerCase().trim())
    )
    await Promise.all(
      toDelete.map((m) => api.delete<void>(`/tournaments/${tournamentId}/memberships/${m.id}/`))
    )
    return { deleted: toDelete.length }
  },
}

// -------------------------------------------------------------------------
// Sheet Configs
// -------------------------------------------------------------------------
export type SheetType = 'volunteers' | 'events'

// -------------------------------------------------------------------------
// Form question option — a single answer choice from a Google Form.
// Returned inside MappedHeader when the backend matched a form question.
// Also persisted in ColumnMapping so edit page + exports retain alias editor.
// -------------------------------------------------------------------------
export interface FormQuestionOption {
  raw:   string   // exact string as it appears in the form
  alias: string   // auto-suggested short version for DB storage
}

export type ParseRuleCondition = 'always' | 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'regex'
export type ParseRuleAction    =
  | 'set' | 'replace' | 'prepend' | 'append' | 'discard'
  | 'parse_time_range'    // canonical action (backend refactor)
  | 'parse_availability'  // legacy alias — kept for backwards compat

export interface ParseRule {
  condition:      ParseRuleCondition
  match?:         string
  case_sensitive: boolean
  action:         ParseRuleAction
  value?:         string
}

export interface ColumnMapping {
  field:         string
  type:          'string' | 'ignore' | 'boolean' | 'integer' | 'multi_select' | 'matrix_row'
  row_key?:      string
  extra_key?:    string
  rules?:        ParseRule[]
  delimiter?:    string
  // Persisted form enrichment — powers alias editor on edit page + JSON exports
  options?:      FormQuestionOption[]
  grid_rows?:    string[]
  grid_columns?: string[]
}

// -------------------------------------------------------------------------
// MappedHeader — one entry per sheet column in the flat /headers/ response.
// Replaces the old headers[] + suggestions{} + form_questions[] triple.
// Enrichment from the Google Form is already cross-referenced server-side.
//
// google_type has been removed — the backend resolves the type fully.
// The frontend Type dropdown is always editable by the TD.
// -------------------------------------------------------------------------
export interface MappedHeader {
  header:        string             // raw column header from the sheet
  field:         string             // suggested target field
  type:          string             // suggested mapping type
  row_key?:      string
  extra_key?:    string
  rules?:        ParseRule[]
  delimiter?:    string
  // Form enrichment — null/absent when no form URL or no question matched
  options?:      FormQuestionOption[]
  grid_rows?:    string[]
  grid_columns?: string[]
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

export interface SheetConfigWithWarnings extends SheetConfig {
  warnings: ValidationIssue[];
}

export interface SyncResult {
  created:        number
  updated:        number
  skipped:        number
  errors:         Array<{ row: number; email: string | null; detail: string }>
  last_synced_at: string
}

export interface ValidationIssue {
  header?:     string[] | string | null
  message:     string
  rule_index?: number
}

export interface ValidateMappingsResult {
  ok:       boolean
  errors:   ValidationIssue[]
  warnings: ValidationIssue[]
}

// Flat response — one MappedHeader per sheet column, enrichment already merged.
export interface SheetHeadersResponse {
  sheet_name:            string
  sheet_type:            string
  mappings:              MappedHeader[]
  known_fields:          string[]
  valid_types:           string[]
  valid_rule_conditions: string[]
  valid_rule_actions:    string[]
}

export const sheetsApi = {
  validate: (tournamentId: number, sheet_url: string) =>
    api.post<{ spreadsheet_id: string; spreadsheet_title: string; sheet_names: string[] }>(
      `/tournaments/${tournamentId}/sheets/validate/`, { sheet_url }
    ),
  headers: (
    tournamentId: number,
    sheet_url: string,
    sheet_name: string,
    sheet_type: SheetType,
    form_url?: string,
  ) =>
    api.post<SheetHeadersResponse>(
      `/tournaments/${tournamentId}/sheets/headers/`,
      { sheet_url, sheet_name, sheet_type, ...(form_url ? { form_url } : {}) }
    ),
  listConfigs:  (tournamentId: number) =>
    api.get<SheetConfig[]>(`/tournaments/${tournamentId}/sheets/configs/`),
  getConfig:    (tournamentId: number, id: number) =>
    api.get<SheetConfig>(`/tournaments/${tournamentId}/sheets/configs/${id}/`),
  validateMappings: (tournamentId: number, column_mappings: Record<string, ColumnMapping>) =>
    api.post<ValidateMappingsResult>(`/tournaments/${tournamentId}/sheets/configs/validate-mappings/`, { column_mappings }),
  createConfig: (tournamentId: number, body: Partial<SheetConfig>) =>
    api.post<SheetConfigWithWarnings>(`/tournaments/${tournamentId}/sheets/configs/`, body),
  updateConfig: (tournamentId: number, id: number, body: Partial<SheetConfig>) =>
    api.patch<SheetConfigWithWarnings>(`/tournaments/${tournamentId}/sheets/configs/${id}/`, body),
  deleteConfig: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/sheets/configs/${id}/`),
  sync:         (tournamentId: number, configId: number) =>
    api.post<SyncResult>(`/tournaments/${tournamentId}/sheets/configs/${configId}/sync/`, {}),
  getEmailsForNuclearDelete: async (tournamentId: number): Promise<string[]> => {
    const memberships = await api.get<{ user?: { email?: string } }[]>(
      `/tournaments/${tournamentId}/memberships/`
    )
    return memberships
      .map((m) => m.user?.email)
      .filter((e): e is string => Boolean(e))
  },
}