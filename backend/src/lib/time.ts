/** Today's date (YYYY-MM-DD) in the given IANA time zone. */
export function localDate(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
