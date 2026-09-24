/** Shared 12-hour (AM/PM) time helpers. Storage stays 24-hour "HH:MM" — display is 12-hour. */

/** "17:23" → "5:23 PM" (passthrough if not HH:MM). */
export function to12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m) return hhmm ?? ''
  let h = Number(m[1])
  const min = m[2]
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${min} ${suffix}`
}

/** ISO/local datetime string → readable "Sep 23, 5:23 PM". */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Current "HH:MM" (24h) for a 12h picker's default. */
export function nowHHMM(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
