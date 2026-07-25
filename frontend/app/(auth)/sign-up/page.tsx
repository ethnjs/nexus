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
  const [state, setState] = useState(1)
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
        setState(2)
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

      setState(2)
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
      {state === 1 && (
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

          <form onSubmit={handleRegisterSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  color: 'var(--color-danger)'
                }}>
                  {errors.form1}
                </p>
              )}
            </div>
          </form>
        </section>
      )}

      {state >= 2 && (
        <section style={{ maxWidth: '600px', width: '100%', margin: '20px 0px'}}>
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
              onSkip={() => setState(5)}
              isActive={state === 2}
            ><Select
                value={profileData.student_status ?? ''}
                onChange={v => {
                  setProfileData(d => ({...d, student_status: v as STUDENT_STATUS}))
                  if (state >= 5) return
                  if (v === 'Undergraduate' || v === 'Graduate') {
                    setState(3)
                  } else if (v === 'Non-Student') {
                    setState(4)
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
            
            { state >= 3 && (profileData.student_status === "Undergraduate" || profileData.student_status === "Graduate") && (
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
                    setState(5)
                  }}
                  onNext={() => {
                    const ers: typeof errors = {}

                    if (!profileData.university) ers.university = "Cannot be empty."
                    if (!profileData.major) ers.major = "Cannot be empty."
                    if (!profileData.year_level) ers.year_level = "Cannot be empty."

                    if (!profileData.graduation_year) ers.graduation_year = "Cannot be empty."
                    else if (profileData.graduation_year < 1000 || profileData.graduation_year > 9999)
                      ers.graduation_year = "Must be a valid year."

                    Object.keys(ers).length > 0 ? setErrors(er => ({...er, ...ers})) : setState(5)
                  }}
                  isActive={state === 3}
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

            {state >= 4 && profileData.student_status === "Non-Student" && (
              <ProfileQuestion
                question="Who is your employer?"
                onSkip={() => setState(5)}
                onNext={() => {
                  !profileData.employer ? setErrors(er => ({...er, employer: "Cannot be empty."})) : setState(5)
                }}
                isActive={state === 4}
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

            {state >= 5 && (
              <ProfileQuestion
                question="Have you competed in Science Olympiad before?"
                onSkip={() => {
                  setState(7)
                }}
                isActive={state === 5}
              ><div style={{ display: 'flex', gap: '8px' }}>
                <RadioOption 
                  name="competed"
                  value="yes"
                  checked={competedBefore === true}
                  onChange={() => {
                    setCompetedBefore(true)
                    if (state >= 7) return
                    setState(6)
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
                    if (state >= 7) return
                    setState(7) 
                  }}
                  label="No"
                  showCircle={false}
                  solid
                />
              </div>
              </ProfileQuestion>
            )}

            {state >= 6 && competedBefore && (
              <ProfileQuestion
                question="List your competition experience."
                onSkip={() => {
                  setCompetedBefore(null)
                  setState(7)
                }}
                onNext={() => {
                  !profileData.competition_exp ? setErrors(er => ({...er, competition_exp: "Cannot be empty."}))
                    : setState(7)
                }}
                isActive={state === 6}
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

            {state >= 7 && (
              <ProfileQuestion
                question="Have you volunteered for Science Olympiad before?"
                onSkip={() => {
                  setState(9)
                }}
                isActive={state === 7}
              ><div style={{ display: 'flex', gap: '8px' }}>
                <RadioOption 
                  name="volunteered"
                  value="yes"
                  checked={volunteeredBefore === true}
                  onChange={() => {
                    setVolunteeredBefore(true)
                    if (state >= 9) return
                    setState(8)
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
                    if (state >= 9) return
                    setState(9) 
                  }}
                  label="No"
                  showCircle={false}
                  solid
                />
              </div>
              </ProfileQuestion>
            )}

            {state >= 8 && volunteeredBefore && (
              <ProfileQuestion
                question="List your volunteer experience."
                onSkip={() => {
                  setVolunteeredBefore(null)
                  setState(9)
                }}
                onNext={() => {
                  !profileData.volunteering_exp ? setErrors(er => ({...er, volunteering_exp: "Cannot be empty."}))
                    : setState(9)
                }}
                isActive={state === 8}
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

            {state >= 9 && (
              <ProfileQuestion
                question="What is your shirt size?"
                onSkip={() => {
                  setProfileData(d => ({...d, shirt_size: undefined}))
                  setState(10)
                }}
                isActive={state === 9}
              ><div style={{ display: 'flex', gap: '8px' }}>
                {["XS", "S", "M", "L", "XL", "XXL"].map(size => (
                  <RadioOption 
                    name="shirt"
                    value={size}
                    key={size}
                    checked={profileData.shirt_size === size}
                    onChange={() => {
                      setProfileData(d => ({...d, shirt_size: size as SHIRT_SIZE}))
                      if (state === 9) setState(10)
                    }}
                    label={size}
                    showCircle={false}
                    solid
                  />
                ))}
              </div>
              </ProfileQuestion>
            )}

            {state >= 10 && (
              <ProfileQuestion
                question="Do you have any dietary restrictions?"
                onSkip={() => {
                  setState(12)
                }}
                isActive={state === 10}
              ><div style={{ display: 'flex', gap: '8px' }}>
                <RadioOption 
                  name="dietary"
                  value="yes"
                  checked={hasDietary === true}
                  onChange={() => {
                    setHasDietary(true)
                    if (state >= 12) return
                    setState(11)
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
                    if (state >= 12) return
                    setState(12) 
                  }}
                  label="No"
                  showCircle={false}
                  solid
                />
              </div>
              </ProfileQuestion>
            )}

            {state >= 11 && hasDietary && (
              <ProfileQuestion
                question="List your dietary restrictions."
                onSkip={() => {
                  setHasDietary(null)
                  setState(12)
                }}
                onNext={() => {
                  !profileData.dietary_restriction ? setErrors(er => ({...er, dietary_restriction: "Cannot be empty."}))
                    : setState(12)
                }}
                isActive={state === 11}
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
                disabled={state !== 12}
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