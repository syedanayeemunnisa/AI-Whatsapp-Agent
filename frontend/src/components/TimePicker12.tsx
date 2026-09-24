/** Shared 12-hour (AM/PM) time picker — value stays 24h "HH:MM" for the API. */

const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function partsOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return { hour: h % 12 || 12, minute: String(m ?? 0).padStart(2, '0'), suffix: h >= 12 ? 'PM' : 'AM' }
}

export function TimePicker12({ value, onChange }: { value: string; onChange: (hhmm: string) => void }) {
  const p = partsOf(value)
  const set = (hour: number, minute: string, suffix: string) => {
    const h = (hour % 12) + (suffix === 'PM' ? 12 : 0)
    onChange(`${String(h).padStart(2, '0')}:${minute}`)
  }
  const sel =
    'rounded-lg border-0 bg-white px-2 py-2 text-sm text-slate-900 ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none'
  return (
    <div className="flex gap-1.5">
      <select aria-label="Hour (12-hour)" className={sel} value={p.hour} onChange={(e) => set(Number(e.target.value), p.minute, p.suffix)}>
        {HOURS12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="self-center text-sm text-slate-500">:</span>
      <select aria-label="Minute" className={sel} value={p.minute} onChange={(e) => set(p.hour, e.target.value, p.suffix)}>
        {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select aria-label="AM or PM" className={sel} value={p.suffix} onChange={(e) => set(p.hour, p.minute, e.target.value)}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
