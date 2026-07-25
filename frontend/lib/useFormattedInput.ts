import { useCallback } from "react"

/**
 * Handles the classic controlled-input-with-formatting bug: when a format
 * function inserts separator characters (spaces, parens, dashes), backspacing
 * over a separator can strip to the same raw value as before, so React sees
 * no change and the field appears stuck. This detects that case and manually
 * drops the last raw character instead.
 */
export function useFormattedInputChange(
  raw: string,
  setRaw: (next: string) => void,
  format: (raw: string) => string,
  stripAndLimit: (input: string) => string = (v) => v.replace(/\D/g, ''),
) {
  return useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value
    const newRaw = stripAndLimit(inputVal)

    const nextRaw = newRaw === raw && inputVal.length < format(raw).length
      ? raw.slice(0, -1)
      : newRaw

    setRaw(nextRaw)
  }, [raw, setRaw, format, stripAndLimit])
}