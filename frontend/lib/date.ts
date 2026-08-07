// Returns today's date in the local timezone as YYYY-MM-DD, suitable for
// <input type="date"> min/max attributes (which are timezone-naive).
export function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
