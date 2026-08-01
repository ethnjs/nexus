'use client'

import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { RadioGroup } from "@/components/ui/RadioGroup"
import { Combobox } from "@/components/ui/Combobox"
import { Textarea } from "@/components/ui/Textarea"
import { STUDENT_STATUS, SHIRT_SIZE, University } from "@/lib/api"

// -------------------------------------------------------------------------
// Pronouns
// -------------------------------------------------------------------------
const COMMON_PRONOUNS = ["she/her", "he/him", "they/them", "she/they", "he/they", "any pronouns"]

interface PronounsFieldProps {
  value: string
  onChange: (value: string) => void
  error?: string
}

export function PronounsField({ value, onChange, error }: PronounsFieldProps) {
  return (
    <Combobox
      options={COMMON_PRONOUNS}
      getId={(p) => p}
      getLabel={(p) => p}
      value={value}
      allowFreeText
      placeholder="Type your pronouns..."
      error={error}
      onChange={(text) => onChange(text)}
    />
  )
}

// -------------------------------------------------------------------------
// Student status
// -------------------------------------------------------------------------
interface StudentStatusFieldProps {
  value: STUDENT_STATUS | undefined
  onChange: (value: STUDENT_STATUS) => void
}

export function StudentStatusField({ value, onChange }: StudentStatusFieldProps) {
  return (
    <Select
      value={value ?? ''}
      onChange={(v) => onChange(v as STUDENT_STATUS)}
      options={[
        { value: "Undergraduate", label: "Undergraduate" },
        { value: "Graduate", label: "Graduate" },
        { value: "Non-Student", label: "Non-Student" },
      ]}
      fullWidth
    />
  )
}

// -------------------------------------------------------------------------
// Education (university / major / year level / graduation year)
// -------------------------------------------------------------------------
export interface EducationDraft {
  university_id?: number
  major?: string
  year_level?: number
  graduation_year?: number
}

export interface EducationErrors {
  university?: string
  major?: string
  year_level?: string
  graduation_year?: string
}

interface UniversityFieldProps {
  universities: University[]
  value: string
  onChange: (text: string, universityId: number | null) => void
  error?: string
}

export function UniversityField({ universities, value, onChange, error }: UniversityFieldProps) {
  return (
    <Combobox
      options={universities}
      getId={u => u.id}
      getLabel={u => u.name}
      getSearchText={u => `${u.name} ${u.abbreviation ?? ''}`}
      value={value}
      allowFreeText={false}
      error={error}
      onChange={(text, matched) => onChange(text, matched ? matched.id : null)}
    />
  )
}

interface MajorFieldProps {
  value: string | undefined
  onChange: (value: string) => void
  error?: string
}

export function MajorField({ value, onChange, error }: MajorFieldProps) {
  return <Input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} error={error} fullWidth />
}

interface YearLevelFieldProps {
  value: number | undefined
  onChange: (value: number) => void
  error?: string
}

export function YearLevelField({ value, onChange, error }: YearLevelFieldProps) {
  return (
    <Select
      value={value !== undefined ? String(value) : ''}
      onChange={(v) => onChange(Number(v))}
      options={[
        { value: "1", label: "1st Year" },
        { value: "2", label: "2nd Year" },
        { value: "3", label: "3rd Year" },
        { value: "4", label: "4th Year" },
        { value: "5", label: "5th+ Year" },
      ]}
      error={error}
      fullWidth
    />
  )
}

interface GraduationYearFieldProps {
  value: number | undefined
  onChange: (value: number | undefined) => void
  error?: string
  onValidate?: (error: string | undefined) => void
}

export function GraduationYearField({ value, onChange, error, onValidate }: GraduationYearFieldProps) {
  return (
    <Input
      type="text"
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
        onValidate?.(raw.length > 0 && raw.length < 4 ? "Must be a valid year." : undefined)
        onChange(raw ? Number(raw) : undefined)
      }}
      error={error}
      fullWidth
    />
  )
}

// -------------------------------------------------------------------------
// Employer
// -------------------------------------------------------------------------
interface EmployerFieldProps {
  value: string | undefined
  onChange: (value: string) => void
  error?: string
}

export function EmployerField({ value, onChange, error }: EmployerFieldProps) {
  return <Input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} error={error} fullWidth />
}

// -------------------------------------------------------------------------
// Yes/No toggle (used for competed-before / volunteered-before / has-dietary)
// -------------------------------------------------------------------------
interface YesNoFieldProps {
  name: string
  value: boolean | null
  onChange: (value: boolean) => void
  disabled?: boolean
}

export function YesNoField({ name, value, onChange, disabled }: YesNoFieldProps) {
  return (
    <RadioGroup
      name={name}
      value={value === true ? "yes" : value === false ? "no" : null}
      onChange={(v) => onChange(v === "yes")}
      options={[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
      showCircle={false}
      solid
      disabled={disabled}
    />
  )
}

// -------------------------------------------------------------------------
// Shirt size
// -------------------------------------------------------------------------
interface ShirtSizeFieldProps {
  value: SHIRT_SIZE | undefined
  onChange: (value: SHIRT_SIZE) => void
}

export function ShirtSizeField({ value, onChange }: ShirtSizeFieldProps) {
  return (
    <RadioGroup
      name="shirt"
      value={value ?? null}
      onChange={(v) => onChange(v as SHIRT_SIZE)}
      options={["XS", "S", "M", "L", "XL", "XXL"].map((size) => ({ value: size, label: size }))}
      showCircle={false}
      solid
    />
  )
}

// -------------------------------------------------------------------------
// Dietary restriction text
// -------------------------------------------------------------------------
interface DietaryRestrictionFieldProps {
  value: string | undefined
  onChange: (value: string) => void
  error?: string
}

export function DietaryRestrictionField({ value, onChange, error }: DietaryRestrictionFieldProps) {
  return <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} error={error} />
}