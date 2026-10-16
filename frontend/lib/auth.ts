// A redirect target from a query param is untrusted input — only accept a
// same-origin relative path (single leading '/', no protocol-relative "//"
// trick, no embedded scheme) so it can't be used as an open redirect.
// Returns null if unsafe or absent.
export function safeRedirectPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return null;
  return path;
}

const DISCORD_LINK_ERRORS: Record<string, string> = {
  discord_already_linked: "That Discord account is already linked to another NEXUS account.",
  discord_link_exists:
    "Your NEXUS account is already linked to a different Discord account. Unlink it in Settings → Security first.",
  discord_cancelled: "Linking was cancelled in Discord.",
  discord_unavailable: "Discord linking isn't available right now.",
};

// Messages for the `error` param the Discord link callback redirects with.
export function discordLinkErrorMessage(code: string | null): string | null {
  if (!code?.startsWith("discord_")) return null;
  return DISCORD_LINK_ERRORS[code] ?? "Something went wrong linking Discord. Try again.";
}

export function validateEmail(email: string): string | null {
  if (!email) return "Cannot be empty.";
  if (!email.includes("@")) return "An email address must have an @-sign.";
  const atLoc = email.indexOf("@");
  if (atLoc === email.length - 1) return "There must be something after the @-sign.";
  if (!email.includes(".", atLoc))
    return "The part after the @-sign is not valid. It should have a period.";
  if (email.indexOf(".", atLoc) === email.length - 1)
    return "An email address cannot end with a period.";
  return null;
}

export function validatePhone(phone: string): string | null {
  if (!phone) return "Cannot be empty.";
  if (phone.length < 10) return "Phone number is invalid.";
  return null;
}

export function formatPhone(phone: string): string {
  phone = phone.replace(/\D/g, "");
  if (phone.length < 3) return phone;
  if (phone.length < 7) return `(${phone.slice(0, 3)}) ${phone.slice(3)}`;
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 10)}`;
}

// Mirrors backend/app/schemas/auth.py — keep the two in sync.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordChecks {
  length: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
  symbol: boolean;
  valid: boolean;
  confirm: boolean;
}

export const EMPTY_PASSWORD_CHECKS: PasswordChecks = {
  length: false,
  upper: false,
  lower: false,
  number: false,
  symbol: false,
  valid: true,
  confirm: false,
};

// confirm password can be null to allow to just run the other checks on the password by itself
export function checkPassword(password: string, confirm: string | null = null): PasswordChecks {
  // valid means "no disallowed characters", so it starts true (an empty password fails on length instead)
  const checks: PasswordChecks = {
    length: false,
    upper: false,
    lower: false,
    number: false,
    symbol: false,
    valid: true,
    confirm: false,
  };

  if (password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH)
    checks.length = true;

  // Only printable ASCII ('!' through '~') is allowed. Validity is checked
  // first so a disallowed character can never satisfy a class.
  for (const c of password) {
    if (c < "!" || c > "~") checks.valid = false;
    else if (c >= "0" && c <= "9") checks.number = true;
    else if (c >= "A" && c <= "Z") checks.upper = true;
    else if (c >= "a" && c <= "z") checks.lower = true;
    else checks.symbol = true;
  }

  if (password && password === confirm) checks.confirm = true;

  return checks;
}

// Validates password requirements only — confirm password is checked separately
// in the component so each error maps to its own field.
export function validatePassword(password: string): string | null {
  const checks = checkPassword(password);

  const { confirm, ...rest } = checks;
  if (Object.values(rest).some((v) => !v)) return "Some password requirements are not met. ";

  return null;
}

export const DATE_OF_BIRTH_DISCLAIMER =
  "We only use your birthday to check your age, since some tournaments require volunteers to be 18 or older. " +
  "It's never shown to anyone on NEXUS, including tournament directors — they can only see whether you're 18+, not your actual birthday.";

export function validateDateOfBirth(value: string): string | null {
  if (!value) return "Cannot be empty.";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Must be a valid date.";

  if (date.getTime() > Date.now()) return "Cannot be in the future.";

  return null;
}
