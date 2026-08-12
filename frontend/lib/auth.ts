

export function validateEmail(email: string): string | null {
    if (!email) return "Cannot be empty."
    if (!email.includes('@')) return "An email address must have an @-sign."
    const atLoc = email.indexOf('@')
    if (atLoc === email.length - 1) return "There must be something after the @-sign."
    if (!email.includes('.', atLoc)) return "The part after the @-sign is not valid. It should have a period."
    if (email.indexOf('.', atLoc) === email.length - 1) return "An email address cannot end with a period."
    return null
}

export function validatePhone(phone: string): string | null {
    if (!phone) return "Cannot be empty."
    if (phone.length < 10) return "Phone number is invalid."
    return null
}

export function formatPhone(phone: string): string {
    phone = phone.replace(/\D/g, '')
    if (phone.length < 3) return phone
    if (phone.length < 7) return `(${phone.slice(0, 3)}) ${phone.slice(3)}`
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 10)}`
}

export interface PasswordChecks {
    length:  boolean
    upper:   boolean
    lower:   boolean
    number:  boolean
    symbol:  boolean
    confirm: boolean
}

function isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
}

function isUpper(char: string): boolean {
    return char >= 'A' && char <= 'Z'
}

function isLower(char: string): boolean {
    return char >= 'a' && char <= 'z'
}

function isValidSymbol(char: string): boolean {
    return (char >= '!' && char <= '/') || (char >= ':' && char <= '@') || (char >= '[' && char <= '`') || (char >= '{' && char <= '~')
}

// confirm password can be null to allow to just run the other checks on the password by itself
export function checkPassword(password: string, confirm: string | null = null): PasswordChecks {
    const checks: PasswordChecks = {length: false, upper: false, lower: false, number: false, symbol: false, confirm: false}

    if (password.length >= 8) checks["length"] = true

    for (const c of password) {
        if (!checks["number"] && isDigit(c)) { checks["number"] = true; continue; }
        if (!checks["upper"] && isUpper(c)) { checks["upper"] = true; continue; }
        if (!checks["lower"] && isLower(c)) { checks["lower"] = true; continue; }
        if (!checks["symbol"] && isValidSymbol(c)) { checks["symbol"] = true; continue; }
    }


    if (password && password === confirm) checks["confirm"] = true

    return checks
}

// Validates password requirements only — confirm password is checked separately
// in the component so each error maps to its own field.
export function validatePassword(password: string): string | null {
    const checks = checkPassword(password)

    const { confirm, ...rest } = checks
    if (Object.values(rest).some(v => !v)) return "Some password requirements are not met. "

    return null
}

export const DATE_OF_BIRTH_DISCLAIMER =
  "We only use your birthday to check your age, since some tournaments require volunteers to be 18 or older. " +
  "It's never shown to anyone on NEXUS, including tournament directors — they can only see whether you're 18+, not your actual birthday."

export function validateDateOfBirth(value: string): string | null {
  if (!value) return "Cannot be empty."

  const date = new Date(value + "T00:00:00")
  if (isNaN(date.getTime())) return "Must be a valid date."

  if (date.getTime() > Date.now()) return "Cannot be in the future."

  return null
}