'use client'

import { useEffect, useState } from "react"
import { User, STUDENT_STATUS, authApi, ApiError, SHIRT_SIZE, usersApi } from "@/lib/api"
import { useRouter } from "next/navigation"
import { checkPassword, formatPhone, validateEmail, validatePassword, validatePhone } from "@/lib/auth"
import { IconArrowLeft, IconCheckCircleSolid, IconXCircleSolid } from "@/components/ui/Icons"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Select } from "@/components/ui/Select"
import { RadioOption } from "@/components/ui/RadioOption"
import { Textarea } from "@/components/ui/Textarea"
import { Modal } from "@/components/ui/Modal"



interface ProfileQuestionProps {
  question: string
  children: React.ReactNode
  onSkip?: () => void
  onNext?: () => void
  isActive?: boolean
}

function ProfileQuestion({
  question,
  children,
  onSkip = undefined,
  onNext = undefined,
  isActive = false
}: ProfileQuestionProps) {
  const showSkip = !!onSkip
  const showNext = !!onNext
  return (
    <div style={{marginBottom: '20px'}}>
      <p style={{ marginBottom: '5px', fontFamily: 'var(--font-sans)', fontSize: '18px', color: 'var(--color-text-primary)' }}>{question}</p>
      {children}
      {isActive && (showSkip || showNext) && (
        <div style={{marginTop: '10px', justifyContent:'right', display: 'flex', gap: '5px'}}>
          {showSkip && (<Button
            type="button"
            variant="secondary"
            onClick={onSkip}
          >Skip</Button>)}
          {showNext && (<Button
            type="button"
            variant="primary"
            onClick={onNext}
          >Next</Button>)}
        </div>
      )}
    </div>
  )
}

function setCookie() {
  document.cookie = "inSignUpFlow=true; path=/"
}

function clearCookie() {
  document.cookie = "inSignUpFlow=; path=/; max-age=0"
}

const STATE = {
  ACCOUNT: 1,
  STUDENT_STATUS: 2,
  UNIVERSITY: 3,
  EMPLOYER: 4,
  COMPETED_BEFORE: 5,
  COMPETITION_EXP: 6,
  VOLUNTEERED_BEFORE: 7,
  VOLUNTEERING_EXP: 8,
  SHIRT_SIZE: 9,
  DIETARY_RESTRICTIONS: 10,
  DIETARY_TEXT: 11,
  COMPLETE: 12,
} as const

export default function SignUpPage() {
  // ── Sign-up step states ──────────────────────────────────────────────────
  //  1  Account creation form
  //  2  Student status question
  //  3  University, major, year level, graduation year  (student path)
  //  4  Employer                                        (non-student path)
  //  5  Competed in Science Olympiad before?            (yes / no)
  //  6  Competition experience text
  //  7  Volunteered for Science Olympiad before?        (yes / no)
  //  8  Volunteering experience text
  //  9  Shirt size
  // 10  Dietary restrictions?                           (yes / no)
  // 11  Dietary restriction text
  // 12  Complete button activated
  // ────────────────────────────────────────────────────────────────────────
  const [state, setState] = useState<number>(STATE.ACCOUNT)
  const [user, setUser] = useState<User | null>(null)
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

  const [showVerifyModal, setShowVerifyModal] = useState(false)

  const [profileData, setProfileData] = useState<{
    student_status?: STUDENT_STATUS
    university?: string
    major?: string
    year_level?: number
    graduation_year?: number

    employer?: string

    competition_exp?: string
    volunteering_exp?: string

    shirt_size?: SHIRT_SIZE
    dietary_restriction?: string
  }>({})
  const [competedBefore, setCompetedBefore] = useState<boolean | null>(null)
  const [volunteeredBefore, setVolunteeredBefore] = useState<boolean | null> (null)
  const [hasDietary, setHasDietary] = useState<boolean | null>(null)


  const [errors, setErrors] = useState<{
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
    password?: string
    confirm_password?: string
    form1?: string

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
    authApi.me().then(user => {
      if (document.cookie.includes("inSignUpFlow")) {
        setUser(user)
        setState(STATE.STUDENT_STATUS)
      } else {
        router.push('/dashboard')
      }
    }).catch(() => {})
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
      }).catch(() => {}).finally(() => setState(STATE.STUDENT_STATUS))
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
          <IconCheckCircleSolid style={{ color: 'var(--color-success)', marginBottom: '20px' }} size={72} />
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

    const cleaned = { ...profileData }

    if (cleaned.student_status === 'Undergraduate' || cleaned.student_status === 'Graduate') {
      cleaned.employer = undefined
    } else if (cleaned.student_status === 'Non-Student') {
      cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined
    } else {
      cleaned.student_status = cleaned.employer = cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined
    }

    cleaned.competition_exp  = competedBefore === false ? "No competition experience."  : competedBefore === null  ? undefined : cleaned.competition_exp
    cleaned.volunteering_exp = volunteeredBefore === false ? "No volunteer experience." : volunteeredBefore === null ? undefined : cleaned.volunteering_exp

    for (const key of Object.keys(cleaned)) {
      if (cleaned[key as keyof typeof cleaned] === "") {
        (cleaned as Record<string, unknown>)[key] = undefined
      }
    }

    if (cleaned.graduation_year && (cleaned.graduation_year < 1000 || cleaned.graduation_year > 9999)) {
      setErrors(er => ({...er, graduation_year: "Must be a valid year."}))
      setLoading(false)
      return
    }

    try {
      await usersApi.updateMe(cleaned)

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
                const raw = e.target.value.replace(/\D/g, '').slice(0, 10)
                setPhone(raw);
                setErrors(er => ({ ...er, phone: undefined }));
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
                    ? <IconCheckCircleSolid style={{ color: 'var(--color-success)' }} />
                    : <IconXCircleSolid style={{ color: 'var(--color-danger)' }} />
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

      {state >= STATE.STUDENT_STATUS && (
        <section style={{ maxWidth: '600px', width: '100%', margin: '20px 0px'}}>
          {showVerifyModal && <VerifyModal />}

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
            }}>Complete Your Profile</h2>
          </div>

          <form onSubmit={handleProfileSubmit} noValidate>
            <ProfileQuestion
              question="What is your student status?"
              onSkip={() => setState(STATE.STUDENT_STATUS + 3)}
              isActive={state === STATE.STUDENT_STATUS}
            ><Select
                value={profileData.student_status ?? ''}
                onChange={v => {
                  setProfileData(d => ({...d, student_status: v as STUDENT_STATUS}))
                  if (state >= (STATE.STUDENT_STATUS + 3)) return
                  if (v === 'Undergraduate' || v === 'Graduate') {
                    setState(STATE.UNIVERSITY)
                  } else if (v === 'Non-Student') {
                    setState(STATE.EMPLOYER)
                  }
                }}
                options={[
                  { value: "Undergraduate", label: "Undergraduate" },
                  { value: "Graduate", label: "Graduate" },
                  { value: "Non-Student", label: "Non-Student" }
                ]}
                fullWidth
              />
            </ProfileQuestion>

            { state >= STATE.UNIVERSITY && (profileData.student_status === "Undergraduate" || profileData.student_status === "Graduate") && (
              <div>
                <ProfileQuestion question="What university do you attend?">
                  <Input
                      type="text"
                      value={profileData.university}
                      onChange={e => {
                        setProfileData(d => ({...d, university: e.target.value}))
                        setErrors(er => ({...er, university: undefined}))
                      }}
                      error={errors.university}
                  />
                </ProfileQuestion>
                <ProfileQuestion question="What is your major?">
                  <Input
                      type="text"
                      value={profileData.major}
                      onChange={e => {
                        setProfileData(d => ({...d, major: e.target.value}))
                        setErrors(er => ({...er, major: undefined}))
                      }}
                      error={errors.major}
                  />
                </ProfileQuestion>
                <ProfileQuestion question="What is your grade level?">
                  <Select
                    value={String(profileData.year_level ?? '')}
                    onChange={v => {
                      setProfileData(d => ({...d, year_level: Number(v)}))
                      setErrors(er => ({...er, year_level: undefined}))
                    }}
                    options={[
                      { value: "1", label: "1st Year" },
                      { value: "2", label: "2nd Year" },
                      { value: "3", label: "3rd Year" },
                      { value: "4", label: "4th Year" },
                      { value: "5", label: "5th+ Year" },
                    ]}
                    error={errors.year_level}
                    fullWidth
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
                ><Input
                      type="text"
                      value={profileData.graduation_year}
                      onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
                        setErrors(er => ({ ...er, graduation_year: raw.length > 0 && raw.length < 4 ? "Must be a valid year." : undefined }))
                        setProfileData(d => ({ ...d, graduation_year: raw ? Number(raw) : undefined }))
                      }}

                      error={errors.graduation_year}
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
              ><Input
                    type="text"
                    value={profileData.employer}
                    onChange={e => {
                      setProfileData(d => ({...d, employer: e.target.value}))
                      setErrors(er => ({...er, employer: undefined}))
                    }}
                    error={errors.employer}
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
              ><div style={{ display: 'flex', gap: '8px' }}>
                <RadioOption
                  name="competed"
                  value="yes"
                  checked={competedBefore === true}
                  onChange={() => {
                    setCompetedBefore(true)
                    if (state >= STATE.COMPETED_BEFORE + 2) return
                    setState(STATE.COMPETITION_EXP)
                  }}
                  label="Yes"
                  showCircle={false}
                  solid
                />
                <RadioOption
                  name="competed"
                  value="no"
                  checked={competedBefore === false}
                  onChange={() => {
                    setCompetedBefore(false)
                    if (state >= STATE.COMPETED_BEFORE + 2) return
                    setState(STATE.COMPETED_BEFORE + 2)
                  }}
                  label="No"
                  showCircle={false}
                  solid
                />
              </div>
              </ProfileQuestion>
            )}

            {state >= STATE.COMPETITION_EXP && competedBefore && (
              <ProfileQuestion
                question="List your competition experience."
                onSkip={() => {
                  setCompetedBefore(null)
                  setState(STATE.VOLUNTEERED_BEFORE)
                }}
                onNext={() => {
                  !profileData.competition_exp ? setErrors(er => ({...er, competition_exp: "Cannot be empty."}))
                    : setState(STATE.VOLUNTEERED_BEFORE)
                }}
                isActive={state === STATE.COMPETITION_EXP}
              ><Textarea
                    value={profileData.competition_exp}
                    onChange={e => {
                      setProfileData(d => ({...d, competition_exp: e.target.value}))
                      setErrors(er => ({...er, competition_exp: undefined}))
                    }}
                    error={errors.competition_exp}
                />
              </ProfileQuestion>
            )}

            {state >= STATE.VOLUNTEERED_BEFORE && (
              <ProfileQuestion
                question="Have you volunteered for Science Olympiad before?"
                onSkip={() => {
                  setState(STATE.SHIRT_SIZE)
                }}
                isActive={state === STATE.VOLUNTEERED_BEFORE}
              ><div style={{ display: 'flex', gap: '8px' }}>
                <RadioOption
                  name="volunteered"
                  value="yes"
                  checked={volunteeredBefore === true}
                  onChange={() => {
                    setVolunteeredBefore(true)
                    if (state >= STATE.SHIRT_SIZE) return
                    setState(STATE.VOLUNTEERING_EXP)
                  }}
                  label="Yes"
                  showCircle={false}
                  solid
                />
                <RadioOption
                  name="volunteered"
                  value="no"
                  checked={volunteeredBefore === false}
                  onChange={() => {
                    setVolunteeredBefore(false)
                    if (state >= STATE.SHIRT_SIZE) return
                    setState(STATE.SHIRT_SIZE)
                  }}
                  label="No"
                  showCircle={false}
                  solid
                />
              </div>
              </ProfileQuestion>
            )}

            {state >= STATE.VOLUNTEERING_EXP && volunteeredBefore && (
              <ProfileQuestion
                question="List your volunteer experience."
                onSkip={() => {
                  setVolunteeredBefore(null)
                  setState(STATE.SHIRT_SIZE)
                }}
                onNext={() => {
                  !profileData.volunteering_exp ? setErrors(er => ({...er, volunteering_exp: "Cannot be empty."}))
                    : setState(STATE.SHIRT_SIZE)
                }}
                isActive={state === STATE.VOLUNTEERING_EXP}
              ><Textarea
                    value={profileData.volunteering_exp}
                    onChange={e => {
                      setProfileData(d => ({...d, volunteering_exp: e.target.value}))
                      setErrors(er => ({...er, volunteering_exp: undefined}))
                    }}
                    error={errors.volunteering_exp}
                />
              </ProfileQuestion>
            )}

            {state >= STATE.SHIRT_SIZE && (
              <ProfileQuestion
                question="What is your shirt size?"
                onSkip={() => {
                  setProfileData(d => ({...d, shirt_size: undefined}))
                  setState(STATE.DIETARY_RESTRICTIONS)
                }}
                isActive={state === STATE.SHIRT_SIZE}
              ><div style={{ display: 'flex', gap: '8px' }}>
                {["XS", "S", "M", "L", "XL", "XXL"].map(size => (
                  <RadioOption
                    name="shirt"
                    value={size}
                    key={size}
                    checked={profileData.shirt_size === size}
                    onChange={() => {
                      setProfileData(d => ({...d, shirt_size: size as SHIRT_SIZE}))
                      if (state === STATE.SHIRT_SIZE) setState(STATE.DIETARY_RESTRICTIONS)
                    }}
                    label={size}
                    showCircle={false}
                    solid
                  />
                ))}
              </div>
              </ProfileQuestion>
            )}

            {state >= STATE.DIETARY_RESTRICTIONS && (
              <ProfileQuestion
                question="Do you have any dietary restrictions?"
                onSkip={() => {
                  setState(STATE.COMPLETE)
                }}
                isActive={state === STATE.DIETARY_RESTRICTIONS}
              ><div style={{ display: 'flex', gap: '8px' }}>
                <RadioOption
                  name="dietary"
                  value="yes"
                  checked={hasDietary === true}
                  onChange={() => {
                    setHasDietary(true)
                    if (state >= STATE.COMPLETE) return
                    setState(STATE.DIETARY_TEXT)
                  }}
                  label="Yes"
                  showCircle={false}
                  solid
                />
                <RadioOption
                  name="dietary"
                  value="no"
                  checked={hasDietary === false}
                  onChange={() => {
                    setHasDietary(false)
                    if (state >= STATE.COMPLETE) return
                    setState(STATE.COMPLETE)
                  }}
                  label="No"
                  showCircle={false}
                  solid
                />
              </div>
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
              ><Textarea
                    value={profileData.dietary_restriction}
                    onChange={e => {
                      setProfileData(d => ({...d, dietary_restriction: e.target.value}))
                      setErrors(er => ({...er, dietary_restriction: undefined}))
                    }}
                    error={errors.dietary_restriction}
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
        </section>
      )}
    </>
  )
}
