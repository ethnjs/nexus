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
    
    let message: string = `HTTP ${res.status}`

    if (typeof detail === 'string') {
      message = detail
    } else if (Array.isArray(detail)) {
      message = detail[0]["ctx"]?.reason ?? detail[0]["msg"]
    }

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
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
}

// -------------------------------------------------------------------------
// Canonical Events & Categories — global list, admin-managed
// -------------------------------------------------------------------------
export interface EventCategory {
  id:   number
  name: string
}

export interface CanonicalEvent {
  id:          number
  name:        string
  category:    EventCategory
}

// Writes are admin-only, under /admin/ — GET stays public/unauthenticated.
export const eventCategoriesApi = {
  list:   ()                                    => api.get<EventCategory[]>('/event-categories/'),
  create: (body: { name: string })              => api.post<EventCategory>('/admin/event-categories/', body),
  update: (id: number, body: { name: string })  => api.patch<EventCategory>(`/admin/event-categories/${id}/`, body),
  delete: (id: number)                          => api.delete<void>(`/admin/event-categories/${id}/`),
}

export const canonicalEventsApi = {
  list:   ()                                              => api.get<CanonicalEvent[]>('/events/'),
  create: (body: { name: string; category_id: number })   => api.post<CanonicalEvent>('/admin/events/', body),
  update: (id: number, body: Partial<{ name: string; category_id: number }>) =>
    api.patch<CanonicalEvent>(`/admin/events/${id}/`, body),
  delete: (id: number)                                    => api.delete<void>(`/admin/events/${id}/`),
}

// -------------------------------------------------------------------------
// Canonical Universities
// -------------------------------------------------------------------------
export interface University {
  id:           number
  name:         string
  abbreviation: string | null
  location:     string | null
}

interface UniversityCreate {
  name:          string
  abbreviation?: string | null
  location?:     string | null
}

interface UniversityUpdate {
  name?:         string
  abbreviation?: string | null
  location?:     string | null
}

export const universitiesApi = {
  list:   ()                                        => api.get<University[]>('/universities/'),
  create: (body: UniversityCreate)                  => api.post<University>('/admin/universities/', body),
  update: (id: number, body: UniversityUpdate)      => api.patch<University>(`/admin/universities/${id}/`, body),
  delete: (id: number)                              => api.delete<void>(`/admin/universities/${id}/`),
}

// -------------------------------------------------------------------------
// Auth / Users
// -------------------------------------------------------------------------
export type ROLE = "admin" | "user"
export type USER_STATUS = "active" | "invited" | "deactivated" | "locked"
export type STUDENT_STATUS = "Undergraduate" | "Graduate" | "Non-Student"
export type SHIRT_SIZE = "XS" | "S" | "M" | "L" | "XL" | "XXL"

export interface CompetitionExperience {
  id:         number
  event:      CanonicalEvent
  school:     string
  notes:      string | null
}

export interface VolunteerExperienceNotes {
  event?: string
  other?: string
}

export interface VolunteerExperience {
  id:              number
  tournament_name: string
  year:            number
  event:           CanonicalEvent | null
  role:            string
  notes:           VolunteerExperienceNotes | null
}

// Matches UserSlimResponse — minimal, public-safe identity. No account-internal
// fields (email_verified/role/status/timestamps) — those live on AdminUserSlim.
// Shown to other users (e.g. chapter members), not just self/admin views.
export interface UserSlim {
  id:         number
  first_name: string | null
  last_name:  string | null
  email:      string
  phone:      string | null
  pronouns:   string | null
  created_at: string
  updated_at: string
}

// Matches AdminUserSlimResponse — slim + account-management fields. Used by
// admin user list/patch, and as the base for self-view (login/register/me).
export interface AdminUserSlim extends UserSlim {
  email_verified: boolean
  role:           ROLE
  status:         USER_STATUS
}

// GET /users/me/ (default) — matches UserMeSlimResponse. No date_of_birth here.
export interface UserMeSlim extends AdminUserSlim {
  is_profile_complete:    boolean
  is_onboarding_complete: boolean
}

// Matches UserFullResponse — slim + profile fields. No account-internal
// fields — this is what chapter leads see on a member's profile.
export interface UserFull extends UserSlim {
  student_status:      STUDENT_STATUS | null
  university:          University | null
  major:               string | null
  year_level:          number | null
  graduation_year:     number | null

  employer:            string | null

  has_competition_experience: boolean | null
  has_volunteer_experience:   boolean | null

  competition_experience: CompetitionExperience[]
  volunteer_experience:   VolunteerExperience[]

  shirt_size:           SHIRT_SIZE | null
  dietary_restriction:  string | null
}

// GET /admin/users/{id}/ + /admin/users/by-email/{email}/ — matches AdminUserFullResponse
export interface AdminUserFull extends UserFull, AdminUserSlim {}

// GET /users/me/?full=true — matches UserMeFullResponse
export interface UserMeFull extends UserFull, UserMeSlim {
  date_of_birth:          string | null
  missing_profile_fields: string[]
}

interface UserUpdate {
  first_name?:          string
  last_name?:           string
  phone?:               string | null
  date_of_birth?:       string | null
  pronouns?:            string | null
  student_status?:      STUDENT_STATUS | null
  university_id?:       number | null
  major?:               string | null
  year_level?:          number | null
  graduation_year?:     number | null
  employer?:            string | null
  has_competition_experience?: boolean | null
  has_volunteer_experience?:   boolean | null
  shirt_size?:          SHIRT_SIZE | null
  dietary_restriction?: string | null
}

// -------------------------------------------------------------------------
// Auth
// -------------------------------------------------------------------------
export interface AuthRegister {
  email:    string
  password: string
}

export interface EmailPendingChange {
  new_email:     string | null
  can_resend_at: string | null
}

export const authApi = {
  login: (email: string, password: string) => api.post<AdminUserSlim>('/auth/login/', { email, password }),
  logout: ()                               => api.post<void>('/auth/logout/', {}),
  register: (body: AuthRegister)           => api.post<AdminUserSlim>('/auth/register/', body),
  verifyEmail: (token: string)             => api.get<void>(`/auth/verify-email/?token=${token}`),
  sendEmailVerification: ()                => api.post<void>('/auth/send-email-verification/', {}),

  getPendingEmailChange: () =>
    api.get<EmailPendingChange>('/auth/email/pending-change/'),
  requestEmailChange: (newEmail: string) =>
    api.post<EmailPendingChange>('/auth/email/request-change/', { new_email: newEmail }),
  confirmEmailChange: (token: string) =>
    api.get<void>(`/auth/email/confirm-change/?token=${token}`),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>('/auth/password/change/', { current_password: currentPassword, new_password: newPassword }),
  requestPasswordReset: (email: string) =>
    api.post<void>('/auth/password/reset/request/', { email }),
  confirmPasswordReset: (token: string, newPassword: string) =>
    api.post<void>('/auth/password/reset/confirm/', { token, new_password: newPassword }),

  confirmAccountSetup: (token: string, password: string) =>
    api.post<AdminUserSlim>('/auth/account-setup/confirm/', { token, password }),

  revertEmailChange: (token: string, newPassword: string) =>
    api.post<void>('/auth/email/revert/', { token, new_password: newPassword }),
}

// -------------------------------------------------------------------------
// Users
// -------------------------------------------------------------------------
export interface UserSession {
  id:              number
  user_agent:      string | null
  ip_address:      string | null
  created_at:      string
  last_active_at:  string | null
  is_current:      boolean
}

export const usersApi = {
  // GET /users/me/ (default) — matches UserMeSlimResponse
  me:       ()                          => api.get<UserMeSlim>('/users/me/'),
  // GET /users/me/?full=true — matches UserMeFullResponse
  meFull:   ()                          => api.get<UserMeFull>('/users/me/?full=true'),
  // PATCH /users/me/ — matches UserMeFullResponse
  updateMe: (body: Partial<UserUpdate>) => api.patch<UserMeFull>('/users/me/', body),

  addCompetitionExperience: (body: { event_id: number; school: string; notes?: string | null }) =>
    api.post<CompetitionExperience>('/users/me/competition-experience/', body),
  updateCompetitionExperience: (id: number, body: Partial<{ event_id: number; school: string; notes: string | null }>) =>
    api.patch<CompetitionExperience>(`/users/me/competition-experience/${id}/`, body),
  deleteCompetitionExperience: (id: number) =>
    api.delete<void>(`/users/me/competition-experience/${id}/`),

  addVolunteerExperience: (body: {
    tournament_name: string
    year: number
    role: string
    event_id?: number | null
    notes?: VolunteerExperienceNotes | null
  }) => api.post<VolunteerExperience>('/users/me/volunteer-experience/', body),
  updateVolunteerExperience: (id: number, body: Partial<{
    tournament_name: string
    year: number
    role: string
    event_id: number | null
    notes: VolunteerExperienceNotes | null
  }>) => api.patch<VolunteerExperience>(`/users/me/volunteer-experience/${id}/`, body),
  deleteVolunteerExperience: (id: number) =>
    api.delete<void>(`/users/me/volunteer-experience/${id}/`),

  getForTournament: (tournamentId: number, userId: number) =>
    api.get<UserSlim>(`/tournaments/${tournamentId}/users/${userId}/`),

  listSessions: ()          => api.get<UserSession[]>('/users/me/sessions/'),
  logoutOtherSessions: ()   => api.post<void>('/users/me/sessions/logout-others/', {}),
  deactivateAccount: (currentPassword: string) =>
    api.post<void>('/users/me/deactivate/', { password: currentPassword }),
  deleteAccount: (currentPassword: string) =>
    api.delete<void>('/users/me/', { password: currentPassword }),
}

// -------------------------------------------------------------------------
// Admin — Users
// -------------------------------------------------------------------------
interface AdminUserUpdate {
  role?:   ROLE
  status?: USER_STATUS
}

export const adminUsersApi = {
  list:       ()                                   => api.get<AdminUserSlim[]>('/admin/users/'),
  get:        (id: number)                         => api.get<AdminUserFull>(`/admin/users/${id}/`),
  getByEmail: (email: string)                      => api.get<AdminUserFull>(`/admin/users/by-email/${encodeURIComponent(email)}/`),
  updateRole: (id: number, body: AdminUserUpdate)  => api.patch<AdminUserSlim>(`/admin/users/${id}/`, body),
  delete:     (id: number)                         => api.delete<void>(`/admin/users/${id}/`),
}


// -------------------------------------------------------------------------
// Tournaments
// -------------------------------------------------------------------------
export const TOURNAMENT_LEVELS = ['invitational', 'regionals', 'state', 'nationals'] as const
export type TournamentLevel = typeof TOURNAMENT_LEVELS[number]

export const TOURNAMENT_DIVISIONS = ['A', 'B', 'C'] as const
export type TournamentDivision = typeof TOURNAMENT_DIVISIONS[number]

export const TOURNAMENT_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana',
  'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'Southern California', 'Northern California',
] as const
export type TournamentState = typeof TOURNAMENT_STATES[number]

export interface Tournament {
  id:          number
  name:        string
  short_name:  string | null
  start_date:  string
  end_date:    string
  university:  University | null
  location:    string | null
  state:       TournamentState
  level:       TournamentLevel
  division:    TournamentDivision[]
  is_public:   boolean
  is_verified: boolean
  is_archived: boolean
  owner_id:    number
  roles:       Role[]
  created_at:  string
  updated_at:  string
}

// location xor university_id — exactly one required, matches backend TournamentCreate
export type TournamentCreate = {
  name:        string
  short_name?: string | null
  start_date:  string
  end_date:    string
  state:       TournamentState
  level:       TournamentLevel
  division:    TournamentDivision[]
  is_public?:  boolean
} & (
  | { location: string; university_id?: never }
  | { university_id: number; location?: never }
)

export interface TournamentUpdate {
  name?:          string
  short_name?:    string | null
  start_date?:    string
  end_date?:      string
  university_id?: number | null
  location?:      string | null
  state?:         TournamentState
  level?:         TournamentLevel
  division?:      TournamentDivision[]
  is_public?:     boolean
}

export const tournamentsApi = {
  // GET /tournaments/me/ — tournaments the current user has any membership in
  list:   ()                                       => api.get<Tournament[]>('/tournaments/me/'),
  get:    (id: number)                             => api.get<Tournament>(`/tournaments/${id}/`),
  create: (body: TournamentCreate)                 => api.post<Tournament>('/tournaments/', body),
  update: (id: number, body: TournamentUpdate)     => api.patch<Tournament>(`/tournaments/${id}/`, body),
  delete: (id: number)                             => api.delete<void>(`/tournaments/${id}/`),
  transferOwnership: (id: number, newOwnerId: number) =>
    api.post<Tournament>(`/tournaments/${id}/transfer-ownership/`, { new_owner_id: newOwnerId }),
  archive:   (id: number) => api.post<Tournament>(`/tournaments/${id}/archive/`, {}),
  unarchive: (id: number) => api.post<Tournament>(`/tournaments/${id}/unarchive/`, {}),
}

// -------------------------------------------------------------------------
// Admin — Tournaments
// -------------------------------------------------------------------------
export const adminTournamentsApi = {
  // GET /admin/tournaments/ — every tournament, regardless of membership
  list: () => api.get<Tournament[]>('/admin/tournaments/'),
  setVerified: (id: number, is_verified: boolean) =>
    api.patch<{ id: number; is_verified: boolean }>(`/admin/tournaments/${id}/verify/`, { is_verified }),
}


// -------------------------------------------------------------------------
// Tournament Shifts — nested under /tournaments/{id}/shifts/, and attached
// to events via /tournaments/{id}/events/{eventId}/shifts/{shiftId}/
// -------------------------------------------------------------------------
export interface TournamentShift {
  id:            number
  tournament_id: number
  label:         string
  start:         string
  end:           string
  created_at:    string
  updated_at:    string
}

export interface TournamentShiftInput {
  label: string
  start: string
  end:   string
}

export const tournamentShiftsApi = {
  list: (tournamentId: number) =>
    api.get<TournamentShift[]>(`/tournaments/${tournamentId}/shifts/`),
  create: (tournamentId: number, body: TournamentShiftInput) =>
    api.post<TournamentShift>(`/tournaments/${tournamentId}/shifts/`, body),
  update: (tournamentId: number, id: number, body: Partial<TournamentShiftInput>) =>
    api.patch<TournamentShift>(`/tournaments/${tournamentId}/shifts/${id}/`, body),
  // Cascades — detaches from any events it was attached to, no confirmation guard.
  delete: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/shifts/${id}/`),
  // 409 on either bounds violation (outside the event's start/end) or
  // overlap with another shift already attached to the same event.
  attach: (tournamentId: number, eventId: number, shiftId: number) =>
    api.post<TournamentShift>(`/tournaments/${tournamentId}/events/${eventId}/shifts/${shiftId}/`, {}),
  detach: (tournamentId: number, eventId: number, shiftId: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/events/${eventId}/shifts/${shiftId}/`),
}

// -------------------------------------------------------------------------
// Tournament Events — nested under /tournaments/{id}/events/
// -------------------------------------------------------------------------
// name is set only for custom (event_id-less) events — a catalog-linked
// event's display name comes from the joined `event` field instead.
export interface TournamentEvent {
  id:                number
  tournament_id:     number
  name:              string | null
  division:          TournamentDivision | null
  event_type:        'standard' | 'trial'
  event_id:          number | null
  // Joined canonical event — set only when event_id is set. Carries
  // category, since TournamentEvent has no category field of its own.
  event:             CanonicalEvent | null
  building:          string | null
  room:              string | null
  floor:             string | null
  volunteers_needed: number | null
  // Nullable — a tournament's event schedule isn't known at planning time.
  // Warn in the UI on unset times rather than blocking on them.
  start_time:        string | null
  end_time:          string | null
  shifts:            TournamentShift[]
  created_at:        string
  updated_at:        string
}

export interface TournamentEventInput {
  name?:              string | null
  division?:          TournamentDivision | null
  event_type?:        'standard' | 'trial'
  event_id?:          number | null
  building?:          string | null
  room?:              string | null
  floor?:             string | null
  volunteers_needed?: number | null
  start_time?:        string | null
  end_time?:          string | null
}

export interface EventLoadDefaultsSkipped {
  event_id: number
  division: string
  name:     string
  reason:   string
}

export interface EventLoadDefaultsResponse {
  created: TournamentEvent[]
  skipped: EventLoadDefaultsSkipped[]
}

export const tournamentEventsApi = {
  list: (tournamentId: number) =>
    api.get<TournamentEvent[]>(`/tournaments/${tournamentId}/events/`),
  get:    (tournamentId: number, id: number) =>
    api.get<TournamentEvent>(`/tournaments/${tournamentId}/events/${id}/`),
  create: (tournamentId: number, body: TournamentEventInput & { tournament_id: number }) =>
    api.post<TournamentEvent>(`/tournaments/${tournamentId}/events/`, body),
  update: (tournamentId: number, id: number, body: Partial<TournamentEventInput>) =>
    api.patch<TournamentEvent>(`/tournaments/${tournamentId}/events/${id}/`, body),
  delete: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/events/${id}/`),
  // Bulk-creates events from every active SeasonEvent whose division the
  // tournament supports. Skips anything already loaded rather than erroring.
  loadDefaults: (tournamentId: number) =>
    api.post<EventLoadDefaultsResponse>(`/tournaments/${tournamentId}/events/load-defaults/`, {}),
}

// -------------------------------------------------------------------------
// Season Events — admin-curated per-year/division active event list, drives
// tournamentEventsApi.loadDefaults(). GET is public; writes are admin-only.
// -------------------------------------------------------------------------
export interface SeasonEvent {
  id:         number
  year:       number
  division:   TournamentDivision
  is_active:  boolean
  event:      CanonicalEvent
  created_at: string
}

export interface SeasonEventInput {
  event_id:   number
  year:       number
  division:   TournamentDivision
  is_active?: boolean
}

export const seasonEventsApi = {
  list: (params: { year?: number; division?: TournamentDivision | TournamentDivision[] } = {}) => {
    const qs = new URLSearchParams();
    if (params.year !== undefined) qs.set('year', String(params.year))
    if (params.division) {
      for (const d of Array.isArray(params.division) ? params.division : [params.division]) qs.append('division', d)
    }
    const query = qs.toString()
    return api.get<SeasonEvent[]>(`/season-events/${query ? `?${query}` : ''}`)
  },
  create: (body: SeasonEventInput) =>
    api.post<SeasonEvent>('/admin/season-events/', body),
  update: (id: number, body: Partial<SeasonEventInput>) =>
    api.patch<SeasonEvent>(`/admin/season-events/${id}/`, body),
  delete: (id: number) =>
    api.delete<void>(`/admin/season-events/${id}/`),
}

// -------------------------------------------------------------------------
// Memberships
// -------------------------------------------------------------------------
export type MembershipStatus = 'interested' | 'confirmed'

// How a membership was created. "manual" covers staff-add, owner-on-create,
// and sync import — collapsed into one value until manual add-by-staff is
// actually removed.
export type MembershipSource = 'join_code' | 'public' | 'manual'

export interface AvailabilitySlot {
  date:  string
  start: string
  end:   string
}

// Matches RoleRead
export interface Role {
  id:             number
  tournament_id:  number
  label:          string
  permissions:    string[]
  rank:           number
  created_at:     string
  updated_at:     string
}

// Matches RoleWithMemberCount — only the role list/CRUD endpoints compute
// this count; roles nested inside membership responses stay plain Role.
export interface RoleWithMemberCount extends Role {
  member_count: number
}

// Matches MembershipJoinCodeInfo — resolved join-code info embedded on a
// membership response (code/label + who created it). Only present when
// source === "join_code". Codes are never hard-deleted, so this is always
// populated for a join_code-sourced membership.
export interface MembershipJoinCodeInfo {
  code:    string
  label:   string | null
  creator: MembershipSlim | UserSlim
}

// Matches MembershipSlimResponse — members-page roster row. No onboarding/
// logistics fields; those live behind the per-member expand panel (MembershipFull).
export interface MembershipSlim {
  id:         number
  source:     MembershipSource
  status:     MembershipStatus
  join_code:  MembershipJoinCodeInfo | null
  // When they joined THIS tournament — distinct from user.created_at
  // (their NEXUS account age).
  created_at: string
  updated_at: string
  roles:      Role[]
  user:       UserSlim
}

// Matches MembershipFullResponse — the expanded side panel for a single member.
export interface MembershipFull {
  id:                number
  tournament_id:     number
  status:            MembershipStatus
  role_preference:   string[] | null
  event_preference:  string[] | null
  availability:      AvailabilitySlot[] | null
  lunch_order:       Record<string, unknown> | string | null
  notes:             string | null
  extra_data:        Record<string, unknown> | null
  source:            MembershipSource
  join_code:         MembershipJoinCodeInfo | null
  is_over_18:        boolean | null
  is_over_21:        boolean | null
  created_at:        string
  updated_at:        string
  roles:             Role[]
  user:              UserFull
}

// PATCH .../memberships/me/ — self-service, onboarding responses only
export interface MembershipMeUpdate {
  role_preference?:  string[] | null
  event_preference?: string[] | null
  availability?:     AvailabilitySlot[] | null
  lunch_order?:      Record<string, unknown> | string | null
}

// PATCH .../memberships/{id}/ — manage_members override, day-of logistics only
export interface MembershipCoordinatorUpdate {
  notes?: string | null
}

// GET .../memberships/me/ — current user's membership + effective permissions
export interface MembershipMe {
  membership_id: number | null
  is_owner:       boolean
  status:         MembershipStatus | null
  roles:          Role[]
  permissions:    Permission[]
}

export const membershipsApi = {
  list: (tournamentId: number) =>
    api.get<MembershipSlim[]>(`/tournaments/${tournamentId}/memberships/`),
  get: (tournamentId: number, id: number) =>
    api.get<MembershipFull>(`/tournaments/${tournamentId}/memberships/${id}/`),
  getMe: (tournamentId: number) =>
    api.get<MembershipMe>(`/tournaments/${tournamentId}/memberships/me/`),
  leaveMe: (tournamentId: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/memberships/me/`),
  updateMe: (tournamentId: number, body: Partial<MembershipMeUpdate>) =>
    api.patch<MembershipFull>(`/tournaments/${tournamentId}/memberships/me/`, body),
  update: (tournamentId: number, id: number, body: Partial<MembershipCoordinatorUpdate>) =>
    api.patch<MembershipFull>(`/tournaments/${tournamentId}/memberships/${id}/`, body),
  delete: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/memberships/${id}/`),
  updateRoles: (tournamentId: number, membershipId: number, body: { add?: number[]; remove?: number[] }) =>
    api.patch<MembershipSlim>(`/tournaments/${tournamentId}/memberships/${membershipId}/roles/`, body),
  // role_id narrows to members holding that role; exclude_role_id drops
  // members who already hold it — independent filters, combinable with q.
  // max_rank drops members whose highest-authority role ties or outranks
  // that rank (lower rank number = more authority) — callers pass their own
  // rank so a search never surfaces someone they couldn't actually assign.
  search: (tournamentId: number, params: { q?: string; role_id?: number; exclude_role_id?: number; max_rank?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q)
    if (params.role_id !== undefined) qs.set('role_id', String(params.role_id))
    if (params.exclude_role_id !== undefined) qs.set('exclude_role_id', String(params.exclude_role_id))
    if (params.max_rank !== undefined) qs.set('max_rank', String(params.max_rank))
    return api.get<MembershipSlim[]>(`/tournaments/${tournamentId}/memberships/search/?${qs.toString()}`)
  },
}

// -------------------------------------------------------------------------
// Tournament Roles — nested under /tournaments/{id}/roles/
// -------------------------------------------------------------------------
// Matches ALL_PERMISSIONS in app/core/tournament/permissions.py
export type Permission =
  | 'manage_tournament'
  | 'manage_roles'
  | 'manage_members'
  | 'manage_events'
  | 'manage_invites'

export const ALL_PERMISSIONS: Permission[] = [
  'manage_tournament', 'manage_roles', 'manage_members', 'manage_events', 'manage_invites',
]

export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
  manage_tournament: {
    label: 'Manage Tournament',
    description: 'Edit tournament settings and view the audit log.',
  },
  manage_roles: {
    label: 'Manage Roles',
    description: 'Create, edit, and delete role definitions, and reorder rank.',
  },
  manage_members: {
    label: 'Manage Members',
    description: 'View and manage the member roster, and assign roles to members.',
  },
  manage_events: {
    label: 'Manage Events',
    description: 'Create and manage events, assign events to buildings, add event shifts, and manage event start and end times.',
  },
  manage_invites: {
    label: 'Manage Invites',
    description: 'Create invite links to the tournament and manage existing ones.',
  },
}

export interface RoleDefinition {
  label:       string
  permissions: Permission[]
  rank:        number
}

// Matches RoleBulkReorder — final ranks are computed client-side by the
// drag-and-drop preview, the backend only rank-bound checks and writes them.
export interface RoleRankAssignment {
  role_id: number
  rank:    number
}

export const rolesApi = {
  list: (tournamentId: number) =>
    api.get<RoleWithMemberCount[]>(`/tournaments/${tournamentId}/roles/`),
  create: (tournamentId: number, body: RoleDefinition) =>
    api.post<RoleWithMemberCount>(`/tournaments/${tournamentId}/roles/`, body),
  update: (tournamentId: number, id: number, body: Partial<RoleDefinition>) =>
    api.patch<RoleWithMemberCount>(`/tournaments/${tournamentId}/roles/${id}/`, body),
  delete: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/roles/${id}/`),
  applyTemplate: (tournamentId: number) =>
    api.post<RoleWithMemberCount[]>(`/tournaments/${tournamentId}/roles/apply-template/`, {}),
  reorderBulk: (tournamentId: number, roles: RoleRankAssignment[]) =>
    api.patch<RoleWithMemberCount[]>(`/tournaments/${tournamentId}/roles/reorder-bulk/`, { roles }),
}

// -------------------------------------------------------------------------
// Invites — nested under /tournaments/{id}/join-codes/ (backend route name
// unchanged; "invite" is the frontend-facing term)
// -------------------------------------------------------------------------
export interface Invite {
  id:         number
  code:       string
  label:      string | null
  expires_at: string | null
  created_at: string
  use_count:  number
  creator:    MembershipSlim | UserSlim
}

export interface InviteCreate {
  label?:            string | null
  expires_in_hours?: number | null
}

export interface InviteUpdate {
  label?:     string | null
  add_hours?: number | null
}

export const invitesApi = {
  list: (tournamentId: number) =>
    api.get<Invite[]>(`/tournaments/${tournamentId}/join-codes/`),
  create: (tournamentId: number, body: InviteCreate) =>
    api.post<Invite>(`/tournaments/${tournamentId}/join-codes/`, body),
  update: (tournamentId: number, id: number, body: InviteUpdate) =>
    api.patch<Invite>(`/tournaments/${tournamentId}/join-codes/${id}/`, body),
  // Deactivates the invite (one-way) — does not delete the row, history stays visible via GET.
  deactivate: (tournamentId: number, id: number) =>
    api.delete<void>(`/tournaments/${tournamentId}/join-codes/${id}/`),
}

// -------------------------------------------------------------------------
// Staff invites — /tournaments/{id}/staff-invites/. Sends one email per
// address pointing at an existing invite's join link. join_code_id must
// already exist — if the caller wants a brand-new invite, create it via
// invitesApi.create first and pass the resulting id here.
// -------------------------------------------------------------------------
export interface StaffInviteCreate {
  join_code_id: number
  emails:       string[]
}

export interface StaffInviteResponse {
  join_code: Invite
  sent:      string[]
  failed:    string[]
}

export const staffInvitesApi = {
  send: (tournamentId: number, body: StaffInviteCreate) =>
    api.post<StaffInviteResponse>(`/tournaments/${tournamentId}/staff-invites/`, body),
}

// -------------------------------------------------------------------------
// Audit log — /tournaments/{id}/audit-log/. Keyset-paginated (before_id/
// limit, not page=) — pass the response's next_before_id back for the next
// page; null means no more results.
// -------------------------------------------------------------------------
export interface AuditLogEntry {
  id:            number
  tournament_id: number
  action:        string
  target_type:   string | null
  target_id:     number | null
  extra_data:    Record<string, unknown> | null
  created_at:    string
  // The actor's membership in this tournament — falls back to the bare user
  // when they have none (e.g. a site admin acting without ever joining).
  actor:         MembershipSlim | UserSlim
  // Current role state — populated only when target_type === "role" and the
  // role still exists (null for role_deleted, and for role_updated's
  // bulk-reorder variant, which has no single target_id).
  role:          Role | null
}

export interface AuditLogPage {
  items:          AuditLogEntry[]
  next_before_id: number | null
}

export interface AuditLogActor {
  actor: MembershipSlim | UserSlim
  // Total entries this actor has in this tournament's log — sorted
  // most-active first by the backend, feeds the "Filter by User" dropdown.
  count: number
}

export interface AuditLogParams {
  limit?:       number
  before_id?:   number
  action?:      string
  target_type?: string
  target_id?:   number
  actor_id?:    number
  since?:       string
  until?:       string
}

export const auditLogApi = {
  list: (tournamentId: number, params: AuditLogParams = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.before_id !== undefined) qs.set('before_id', String(params.before_id))
    if (params.action) qs.set('action', params.action)
    if (params.target_type) qs.set('target_type', params.target_type)
    if (params.target_id !== undefined) qs.set('target_id', String(params.target_id))
    if (params.actor_id !== undefined) qs.set('actor_id', String(params.actor_id))
    if (params.since) qs.set('since', params.since)
    if (params.until) qs.set('until', params.until)
    return api.get<AuditLogPage>(`/tournaments/${tournamentId}/audit-log/?${qs.toString()}`)
  },
  actors: (tournamentId: number) =>
    api.get<AuditLogActor[]>(`/tournaments/${tournamentId}/audit-log/actors/`),
}

// -------------------------------------------------------------------------
// Setup checklist — /tournaments/{id}/setup-checklist/
// -------------------------------------------------------------------------
export interface SetupChecklistItem {
  item_key: string
  label:    string
  status:   'not_started' | 'complete'
}

export interface SetupChecklistResponse {
  items:           SetupChecklistItem[]
  completed_count: number
  total_count:     number
}

export const setupChecklistApi = {
  get: (tournamentId: number) =>
    api.get<SetupChecklistResponse>(`/tournaments/${tournamentId}/setup-checklist/`),
}

// -------------------------------------------------------------------------
// Join — single redemption entry point shared by tournament & chapter codes
// -------------------------------------------------------------------------
export interface JoinRedeemResponse {
  type:          'tournament' | 'chapter'
  target_id:     number
  membership_id: number
}

// GET /join/preview/ — discriminated on `type`, mirrors the backend's
// JoinPreviewTournament/JoinPreviewChapter split.
export interface JoinPreviewTournament {
  type:         'tournament'
  target_id:    number
  name:         string
  short_name:   string | null
  start_date:   string
  end_date:     string
  university:   University | null
  location:     string | null
  state:        string
  level:        string
  division:     string[]
  is_verified:  boolean
}

export interface JoinPreviewChapter {
  type:      'chapter'
  target_id: number
}

export type JoinPreviewResponse = JoinPreviewTournament | JoinPreviewChapter

export const joinApi = {
  redeem: (code: string) =>
    api.post<JoinRedeemResponse>(`/join/?code=${encodeURIComponent(code)}`, {}),
  preview: (code: string) =>
    api.get<JoinPreviewResponse>(`/join/preview/?code=${encodeURIComponent(code)}`),
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
  is_alias?:      boolean
}

export interface ColumnMapping {
  field:         string
  type:          'string' | 'ignore' | 'boolean' | 'integer' | 'multi_select' | 'matrix_row'
  row_key?:      string
  extra_key?:    string
  rules?:        ParseRule[]
  delimiter?:    string
  // Persisted form enrichment — powers alias editor on edit page + JSON exports
  // options is a flat list of raw option strings; aliases are encoded in rules (is_alias=true)
  options?:      string[]
  grid_rows?:    string[]
  grid_columns?: string[]
}

export interface ColumnMappingEntry extends ColumnMapping {
  column_index: number
  header: string
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
  column_index:  number
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
  column_mappings: ColumnMappingEntry[]
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
  column_index?: number[] | number | null
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
  validateMappings: (tournamentId: number, column_mappings: ColumnMappingEntry[]) =>
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
    const memberships = await api.get<MembershipSlim[]>(`/tournaments/${tournamentId}/memberships/`)
    return memberships.map((m) => m.user.email)
  },
}
