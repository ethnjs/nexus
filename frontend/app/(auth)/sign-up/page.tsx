'use client'

import { useEffect, useState } from "react"
import { 
  authApi, ApiError, CanonicalEvent, canonicalEventsApi,
  STUDENT_STATUS, SHIRT_SIZE, UserSlim, usersApi 
} from "@/lib/api"
import { useRouter } from "next/navigation"
import { checkPassword, formatPhone, validateEmail, validatePassword, validatePhone, validateDateOfBirth } from "@/lib/auth"
import { IconArrowLeft, IconCheckCircle, IconXCircle } from "@/components/ui/Icons"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Modal } from "@/components/ui/Modal"
import { ProfileCard } from "@/components/profile/ProfileCard"
import { ProfileQuestion } from "@/components/profile/ProfileQuestion"
import {
  PronounsField, StudentStatusField,
  UniversityField, MajorField, YearLevelField, GraduationYearField,
  EmployerField, YesNoField, ShirtSizeField, DietaryRestrictionField,
} from "@/components/profile/ProfileFields"
import { 
  CompetitionExperienceTable, CompetitionExperienceDraft, isCompetitionRowValid,
  VolunteerExperienceTable, VolunteerExperienceDraft, isVolunteerRowValid
} from "@/components/profile/ExperienceTables"
import { useFormattedInputChange } from "@/lib/useFormattedInput"


function setCookie() {
  document.cookie = "inSignUpFlow=true; path=/"
}

function clearCookie() {
  document.cookie = "inSignUpFlow=; path=/; max-age=0"
}

const STATE = {
  ACCOUNT: 1,
  DATE_OF_BIRTH: 2,
  PRONOUNS: 3,
  STUDENT_STATUS: 4,
  UNIVERSITY: 5,
  EMPLOYER: 6,
  COMPETED_BEFORE: 7,
  COMPETITION_EXP: 8,
  VOLUNTEERED_BEFORE: 9,
  VOLUNTEERING_EXP: 10,
  SHIRT_SIZE: 11,
  DIETARY_RESTRICTIONS: 12,
  DIETARY_TEXT: 13,
  COMPLETE: 14,
} as const

export default function SignUpPage() {
  const [state, setState] = useState<number>(STATE.ACCOUNT)
  const [user, setUser] = useState<UserSlim | null>(null)
  const [loading, setLoading] = useState(false)

  const [name, setName] = useState<{ first: string, last: string }>({ first: '', last: '' })
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordChecks, setPasswordChecks] = useState<{
    length: boolean
    upper: boolean
    lower: boolean
    number: boolean
    symbol: boolean
    confirm: boolean
  }>({ length: false, upper: false, lower: false, number: false, symbol: false, confirm: false })

  const handlePhoneChange = useFormattedInputChange(
    phone,
    setPhone,
    formatPhone,
    (v) => v.replace(/\D/g, '').slice(0, 10),
  )

  const [showVerifyModal, setShowVerifyModal] = useState(false)

  const [profileData, setProfileData] = useState<{
    date_of_birth?: string
    pronouns?: string

    student_status?: STUDENT_STATUS
    university?: string
    major?: string
    year_level?: number
    graduation_year?: number

    employer?: string

    has_competition_experience?: boolean
    has_volunteer_experience?: boolean

    shirt_size?: SHIRT_SIZE
    dietary_restriction?: string
  }>({})
  
  const [events, setEvents] = useState<CanonicalEvent[]>([])
  const [competitionRows, setCompetitionRows] = useState<CompetitionExperienceDraft[]>([])
  const [volunteerRows, setVolunteerRows] = useState<VolunteerExperienceDraft[]>([])
  
  const [hasDietary, setHasDietary] = useState<boolean | null>(null)


  const [errors, setErrors] = useState<{
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
    password?: string
    confirm_password?: string
    form1?: string

    date_of_birth?: string
    pronouns?: string
    student_status?: string
    university?: string
    major?: string
    year_level?: string
    graduation_year?: string
    employer?: string
    competition_exp?: string
    volunteering_exp?: string
    shirt_size?: string
    dietary_restriction?: string
    form2?: string
  }>({})

  const router = useRouter()

  useEffect(() => {
    usersApi.me().then(user => {
      if (document.cookie.includes("inSignUpFlow")) {
        setUser(user)
        setState(STATE.DATE_OF_BIRTH)
      } else {
        router.push('/dashboard')
      }
    }).catch(() => {})

    canonicalEventsApi.list().then(setEvents).catch(() => {})
  }, [])

  async function handleRegisterSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setLoading(true)
    setErrors({})

    const registerErrors = {
      first_name: !name.first ? "Cannot be empty." : undefined,
      last_name: !name.last ? "Cannot be empty." : undefined,
      email: validateEmail(email) ?? undefined,
      phone: validatePhone(phone) ?? undefined,
      password: validatePassword(password) ?? undefined,
      confirm_password: password !== confirmPassword ? "Passwords don't match." : undefined
    }

    if (Object.values(registerErrors).some(v => v)) {
      setErrors(registerErrors)
      setLoading(false)
      return
    }

    try {
      setUser(await authApi.register({
        email: email,
        phone: phone,
        password: password,
        first_name: name.first,
        last_name: name.last
      }))

      setCookie()

      authApi.sendEmailVerification().then(() => {
        setShowVerifyModal(true)
      }).catch(() => {}).finally(() => setState(STATE.DATE_OF_BIRTH))
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrors({ form1: error.message })
      } else {
        setErrors({ form1: "Something went wrong :(" })
      }
    } finally {
      setLoading(false)
    }
  }

  function VerifyModal() {
    return (
      <Modal onClose={() => {}}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <IconCheckCircle style={{ color: 'var(--color-success)', marginBottom: '20px' }} size={72} />
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', color: 'var(--color-text-primary)', marginBottom: '10px' }}>
            Your account was created successfully
          </h2>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', marginBottom: '10px' }}>We sent a verification link to {user?.email ?? email}</p>
          <Button fullWidth onClick={() => setShowVerifyModal(false)}>Got it!</Button>
        </div>
      </Modal>
    )
  }

  async function handleProfileSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setLoading(true)
    setErrors({})

    const cleaned: Record<string, unknown> = { ...profileData }

    if (cleaned.student_status === 'Undergraduate' || cleaned.student_status === 'Graduate') {
      cleaned.employer = undefined
    } else if (cleaned.student_status === 'Non-Student') {
      cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined
    } else {
      cleaned.student_status = cleaned.employer = cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined
    }

    for (const key of Object.keys(cleaned)) {
      if (cleaned[key] === "") cleaned[key] = undefined
    }

    const dobErr = cleaned.date_of_birth ? validateDateOfBirth(cleaned.date_of_birth as string) : null
    if (dobErr) {
      setErrors(er => ({ ...er, date_of_birth: dobErr }))
      setLoading(false)
      return
    }

    if (cleaned.pronouns !== undefined && !(cleaned.pronouns as string).trim()) {
      setErrors(er => ({ ...er, pronouns: "Cannot be empty." }))
      setLoading(false)
      return
    }

    if (cleaned.graduation_year && ((cleaned.graduation_year as number) < 1000 || (cleaned.graduation_year as number) > 9999)) {
      setErrors(er => ({ ...er, graduation_year: "Must be a valid year." }))
      setLoading(false)
      return
    }

    try {
      await usersApi.updateMe(cleaned)

      if (profileData.has_competition_experience) {
        await Promise.all(competitionRows.map(row =>
          usersApi.addCompetitionExperience({
            event_id: row.event_id as number,
            school: row.school,
            notes: row.notes || null,
          })
        ))
      }

      if (profileData.has_volunteer_experience) {
        await Promise.all(volunteerRows.map(row =>
          usersApi.addVolunteerExperience({
            tournament_name: row.tournament_name,
            year: Number(row.year),
            role: row.role,
            event_id: row.event_id ?? undefined,
            notes: (row.event_id === null && row.event_name.trim()) || row.notes_other.trim()
              ? {
                  ...(row.event_id === null && row.event_name.trim() ? { event: row.event_name.trim() } : {}),
                  ...(row.notes_other.trim() ? { other: row.notes_other.trim() } : {}),
                }
              : undefined,
          })
        ))
      }

      clearCookie()
      router.push("/dashboard")
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrors({ form2: error.message })
      } else {
        setErrors({ form2: "Something went wrong :(" })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {state === STATE.ACCOUNT && (
          <section style={{ maxWidth: '420px', width: '100%' }}>
          <div style={{ marginBottom: '5px' }}>
            <button onClick={() => router.push('/')} className="link-subtle" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'var(--font-sans)'
            }}>
              <IconArrowLeft />Back to home
            </button>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <h1 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '48px',
              color: 'var(--color-text-primary)'
            }}>NEXUS</h1>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <h2 style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '28px',
              fontWeight: '700',
              color: 'var(--color-text-primary)'
            }}>Sign Up</h2>
          </div>

          <form onSubmit={handleRegisterSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <Input
              label="First Name"
              type="text"
              value={name.first}
              onChange={e => { setName(n => ({ ...n, first: e.target.value })); setErrors(er => ({ ...er, first_name: undefined })) }}
              autoComplete="given-name"
              error={errors.first_name}
              fullWidth
            />
            <Input
              label="Last Name"
              type="text"
              value={name.last}
              onChange={e => { setName(n => ({ ...n, last: e.target.value })); setErrors(er => ({ ...er, last_name: undefined })) }}
              autoComplete="family-name"
              error={errors.last_name}
              fullWidth
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setErrors(er => ({ ...er, email: undefined })) }}
              autoComplete="email"
              error={errors.email}
              fullWidth
            />
            <Input
              label="Phone Number"
              type="tel"
              value={formatPhone(phone)}
              onChange={e => {
                handlePhoneChange(e)
                setErrors(er => ({ ...er, phone: undefined }))
              }}
              autoComplete="tel"
              error={errors.phone}
              fullWidth
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                setPasswordChecks(checkPassword(e.target.value, confirmPassword))
                setErrors(er => ({ ...er, password: undefined }));
              }}
              autoComplete="new-password"
              error={errors.password}
              fullWidth
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={e => {
                setConfirmPassword(e.target.value);
                setPasswordChecks(checkPassword(password, e.target.value))
                setErrors(er => ({ ...er, confirm_password: undefined }));
              }}
              autoComplete="new-password"
              error={errors.confirm_password}
              fullWidth
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { key: 'length', label: 'At least 8 characters' },
                { key: 'upper', label: 'At least one uppercase letter' },
                { key: 'lower', label: 'At least one lowercase letter' },
                { key: 'number', label: 'At least one number' },
                { key: 'symbol', label: 'At least one special symbol' },
                { key: 'confirm', label: 'Both passwords match' }
              ].map(({ key, label}) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {passwordChecks[key as keyof typeof passwordChecks]
                    ? <IconCheckCircle style={{ color: 'var(--color-success)' }} />
                    : <IconXCircle style={{ color: 'var(--color-danger)' }} />
                  }
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px'}}>{label}</span>
                </div>
              ))}
            </div>
            <Button
              type="submit"
              loading={loading}
              fullWidth
            >Sign Up</Button>

            <div>
              {errors.form1 && (
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-danger)' }}>
                  {errors.form1}
                </p>
              )}
            </div>
          </form>
        </section>
      )}

      {state >= STATE.DATE_OF_BIRTH && (
        <section style={{ maxWidth: '760px', width: '100%', margin: '20px 0px'}}>
          {showVerifyModal && <VerifyModal />}
          <ProfileCard>
            <div style={{ marginBottom: '10px', textAlign: 'center' }}>
              <h1 style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '48px',
                color: 'var(--color-text-primary)'
              }}>NEXUS</h1>
            </div>

            <div style={{ marginBottom: '30px', textAlign: 'center' }}>
              <h2 style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '28px',
                fontWeight: '700',
                color: 'var(--color-text-primary)'
              }}>Complete Your Profile</h2>
            </div>
            <form onSubmit={handleProfileSubmit} noValidate>
              <ProfileQuestion
                question="What is your date of birth?"
                onSkip={() => setState(STATE.PRONOUNS)}
                onNext={() => {
                  const err = validateDateOfBirth(profileData.date_of_birth ?? '')
                  if (err) {
                    setErrors(er => ({ ...er, date_of_birth: err }))
                    return
                  }
                  setState(STATE.PRONOUNS)
                }}
                isActive={state === STATE.DATE_OF_BIRTH}
              ><Input
                    type="date"
                    value={profileData.date_of_birth ?? ''}
                    onChange={e => {
                      setProfileData(d => ({ ...d, date_of_birth: e.target.value }))
                      setErrors(er => ({ ...er, date_of_birth: undefined }))
                    }}
                    error={errors.date_of_birth}
                    fullWidth
                />
              </ProfileQuestion>

              {state >= STATE.PRONOUNS && (
                <ProfileQuestion
                  question="What are your pronouns?"
                  onSkip={() => setState(STATE.STUDENT_STATUS)}
                  onNext={() => {
                    if (!profileData.pronouns?.trim()) {
                      setErrors(er => ({ ...er, pronouns: "Cannot be empty." }))
                      return
                    }
                    setState(STATE.STUDENT_STATUS)
                  }}
                  isActive={state === STATE.PRONOUNS}
                >
                  <PronounsField
                    value={profileData.pronouns ?? ''}
                    error={errors.pronouns}
                    onChange={(v) => {
                      setProfileData(d => ({ ...d, pronouns: v }))
                      setErrors(er => ({ ...er, pronouns: undefined }))
                    }}
                  />
                </ProfileQuestion>
              )}
              
              { state >= STATE.STUDENT_STATUS && (
                <ProfileQuestion
                  question="What is your student status?"
                  onSkip={() => setState(STATE.STUDENT_STATUS + 3)}
                  isActive={state === STATE.STUDENT_STATUS}
                >
                  <StudentStatusField
                    value={profileData.student_status}
                    onChange={(v) => {
                      setProfileData(d => ({...d, student_status: v}))
                      if (state >= (STATE.STUDENT_STATUS + 3)) return
                      if (v === 'Undergraduate' || v === 'Graduate') {
                        setState(STATE.UNIVERSITY)
                      } else if (v === 'Non-Student') {
                        setState(STATE.EMPLOYER)
                      }
                    }}
                  />
                </ProfileQuestion>
              )}

              { state >= STATE.UNIVERSITY && (profileData.student_status === "Undergraduate" || profileData.student_status === "Graduate") && (
                <div>
                  <ProfileQuestion question="What university do you attend?">
                    <UniversityField
                      value={profileData.university}
                      error={errors.university}
                      onChange={(v) => {
                        setProfileData(d => ({...d, university: v}))
                        setErrors(er => ({...er, university: undefined}))
                      }}
                    />
                  </ProfileQuestion>
                  <ProfileQuestion question="What is your major?">
                    <MajorField
                      value={profileData.major}
                      error={errors.major}
                      onChange={(v) => {
                        setProfileData(d => ({...d, major: v}))
                        setErrors(er => ({...er, major: undefined}))
                      }}
                    />
                  </ProfileQuestion>
                  <ProfileQuestion question="What is your grade level?">
                    <YearLevelField
                      value={profileData.year_level}
                      error={errors.year_level}
                      onChange={(v) => {
                        setProfileData(d => ({...d, year_level: v}))
                        setErrors(er => ({...er, year_level: undefined}))
                      }}
                    />
                  </ProfileQuestion>
                  <ProfileQuestion
                    question="What is your projected graduation year?"
                    onSkip={() => {
                      setProfileData(d => ({...d, university: undefined, major: undefined, year_level: undefined, graduation_year: undefined}))
                      setState(STATE.UNIVERSITY + 2)
                    }}
                    onNext={() => {
                      const ers: typeof errors = {}

                      if (!profileData.university) ers.university = "Cannot be empty."
                      if (!profileData.major) ers.major = "Cannot be empty."
                      if (!profileData.year_level) ers.year_level = "Cannot be empty."

                      if (!profileData.graduation_year) ers.graduation_year = "Cannot be empty."
                      else if (profileData.graduation_year < 1000 || profileData.graduation_year > 9999)
                        ers.graduation_year = "Must be a valid year."

                      Object.keys(ers).length > 0 ? setErrors(er => ({...er, ...ers})) : setState(STATE.UNIVERSITY + 2)
                    }}
                    isActive={state === STATE.UNIVERSITY}
                  >
                    <GraduationYearField
                      value={profileData.graduation_year}
                      error={errors.graduation_year}
                      onValidate={(err) => setErrors(er => ({ ...er, graduation_year: err }))}
                      onChange={(v) => setProfileData(d => ({ ...d, graduation_year: v }))}
                    />
                  </ProfileQuestion>
                </div>
              )}

              {state >= STATE.EMPLOYER && profileData.student_status === "Non-Student" && (
                <ProfileQuestion
                  question="Who is your employer?"
                  onSkip={() => setState(STATE.COMPETED_BEFORE)}
                  onNext={() => {
                    !profileData.employer ? setErrors(er => ({...er, employer: "Cannot be empty."})) : setState(STATE.COMPETED_BEFORE)
                  }}
                  isActive={state === STATE.EMPLOYER}
                >
                  <EmployerField
                    value={profileData.employer}
                    error={errors.employer}
                    onChange={(v) => {
                      setProfileData(d => ({...d, employer: v}))
                      setErrors(er => ({...er, employer: undefined}))
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.COMPETED_BEFORE && (
                <ProfileQuestion
                  question="Have you competed in Science Olympiad before?"
                  onSkip={() => {
                    setState(STATE.COMPETED_BEFORE + 2)
                  }}
                  isActive={state === STATE.COMPETED_BEFORE}
                >
                  <YesNoField
                    name="competed"
                    value={profileData.has_competition_experience ?? null}
                    onChange={(val) => {
                      setProfileData(d => ({ ...d, has_competition_experience: val }))
                      if (state >= STATE.COMPETED_BEFORE + 2) return
                      setState(val ? STATE.COMPETITION_EXP : STATE.COMPETED_BEFORE + 2)
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.COMPETITION_EXP && profileData.has_competition_experience && (
                <ProfileQuestion
                  question="Add your competition experience."
                  onSkip={() => {
                    setProfileData(d => ({ ...d, has_competition_experience: undefined }))
                    setCompetitionRows([])
                    setState(STATE.VOLUNTEERED_BEFORE)
                  }}
                  onNext={() => {
                    if (competitionRows.length === 0 || !competitionRows.every(isCompetitionRowValid)) {
                      setErrors(er => ({ ...er, competition_exp: "Each entry needs a school and a matched event." }))
                      return
                    }
                    setState(STATE.VOLUNTEERED_BEFORE)
                  }}
                  isActive={state === STATE.COMPETITION_EXP}
                >
                  <CompetitionExperienceTable value={competitionRows} onChange={setCompetitionRows} events={events} />
                  {errors.competition_exp && (
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)', marginTop: '6px' }}>
                      {errors.competition_exp}
                    </p>
                  )}
                </ProfileQuestion>
              )}

              {state >= STATE.VOLUNTEERED_BEFORE && (
                <ProfileQuestion
                  question="Have you volunteered for Science Olympiad before?"
                  onSkip={() => {
                    setState(STATE.SHIRT_SIZE)
                  }}
                  isActive={state === STATE.VOLUNTEERED_BEFORE}
                >
                  <YesNoField
                    name="volunteered"
                    value={profileData.has_volunteer_experience ?? null}
                    onChange={(val) => {
                      setProfileData(d => ({ ...d, has_volunteer_experience: val }))
                      if (state >= STATE.SHIRT_SIZE) return
                      setState(val ? STATE.VOLUNTEERING_EXP : STATE.SHIRT_SIZE)
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.VOLUNTEERING_EXP && profileData.has_volunteer_experience && (
                <ProfileQuestion
                  question="Add your volunteer experience."
                  onSkip={() => {
                    setProfileData(d => ({ ...d, has_volunteer_experience: undefined }))
                    setVolunteerRows([])
                    setState(STATE.SHIRT_SIZE)
                  }}
                  onNext={() => {
                    if (volunteerRows.length === 0 || !volunteerRows.every(isVolunteerRowValid)) {
                      setErrors(er => ({ ...er, volunteering_exp: "Each entry needs a tournament name, a 4-digit year, and a role." }))
                      return
                    }
                    setState(STATE.SHIRT_SIZE)
                  }}
                  isActive={state === STATE.VOLUNTEERING_EXP}
                >
                  <VolunteerExperienceTable value={volunteerRows} onChange={setVolunteerRows} events={events} />
                  {errors.volunteering_exp && (
                    <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)', marginTop: '6px' }}>
                      {errors.volunteering_exp}
                    </p>
                  )}
                </ProfileQuestion>
              )}

              {state >= STATE.SHIRT_SIZE && (
                <ProfileQuestion
                  question="What is your shirt size?"
                  onSkip={() => {
                    setProfileData(d => ({ ...d, shirt_size: undefined }))
                    setState(STATE.DIETARY_RESTRICTIONS)
                  }}
                  isActive={state === STATE.SHIRT_SIZE}
                >
                  <ShirtSizeField
                    value={profileData.shirt_size}
                    onChange={(v) => {
                      setProfileData(d => ({ ...d, shirt_size: v }))
                      if (state === STATE.SHIRT_SIZE) setState(STATE.DIETARY_RESTRICTIONS)
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.DIETARY_RESTRICTIONS && (
                <ProfileQuestion
                  question="Do you have any dietary restrictions?"
                  onSkip={() => {
                    setState(STATE.COMPLETE)
                  }}
                  isActive={state === STATE.DIETARY_RESTRICTIONS}
                >
                  <YesNoField
                    name="dietary"
                    value={hasDietary}
                    onChange={(val) => {
                      setHasDietary(val)
                      if (state >= STATE.COMPLETE) return
                      setState(val ? STATE.DIETARY_TEXT : STATE.COMPLETE)
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.DIETARY_TEXT && hasDietary && (
                <ProfileQuestion
                  question="List your dietary restrictions."
                  onSkip={() => {
                    setHasDietary(null)
                    setState(STATE.COMPLETE)
                  }}
                  onNext={() => {
                    !profileData.dietary_restriction ? setErrors(er => ({...er, dietary_restriction: "Cannot be empty."}))
                      : setState(STATE.COMPLETE)
                  }}
                  isActive={state === STATE.DIETARY_TEXT}
                >
                  <DietaryRestrictionField
                    value={profileData.dietary_restriction}
                    error={errors.dietary_restriction}
                    onChange={(v) => {
                      setProfileData(d => ({...d, dietary_restriction: v}))
                      setErrors(er => ({...er, dietary_restriction: undefined}))
                    }}
                  />
                </ProfileQuestion>
              )}

              <div style={{marginTop: '10px', display: 'flex', gap: '10px'}}>
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={() => { clearCookie(); router.push("/dashboard") }}
                  fullWidth
                >Skip All</Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={state !== STATE.COMPLETE}
                  loading={loading}
                  fullWidth
                >Complete</Button>
              </div>

              <div>
                {errors.form2 && (
                  <p style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '14px',
                    color: 'var(--color-danger)'
                  }}>
                    {errors.form2}
                  </p>
                )}
              </div>
            </form>
          </ProfileCard>
        </section>
      )}
    </>
  )
}