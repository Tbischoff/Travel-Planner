export type OpeningStatus = 'open' | 'closed' | 'unknown'

// Opening hours currently arrive as human-readable Google weekday descriptions.
// Never treat an unrecognized schedule as closed.
const weekdayIndex: Record<string, number> = {
  sunday: 0, sonntag: 0, so: 0, monday: 1, montag: 1, mo: 1,
  tuesday: 2, dienstag: 2, di: 2, wednesday: 3, mittwoch: 3, mi: 3,
  thursday: 4, donnerstag: 4, do: 4, friday: 5, freitag: 5, fr: 5,
  saturday: 6, samstag: 6, sa: 6,
}
const weekdays = Object.keys(weekdayIndex).sort((a, b) => b.length - a.length)
const weekdayPattern = new RegExp('^\\s*(' + weekdays.join('|') + ')\\s*[:：]\\s*(.*)$', 'i')

function destinationTimeZone(destination: string | null | undefined): string | null {
  const city = (destination || '').toLocaleLowerCase()
  if (/budapest|ungarn|hungary/.test(city)) return 'Europe/Budapest'
  if (/london|united kingdom|vereinigtes königreich|großbritannien|england/.test(city)) return 'Europe/London'
  if (/berlin|deutschland|germany|koblenz|münchen|hamburg|köln|frankfurt/.test(city)) return 'Europe/Berlin'
  if (/wien|vienna|österreich|austria/.test(city)) return 'Europe/Vienna'
  if (/paris|frankreich|france/.test(city)) return 'Europe/Paris'
  if (/rom|rome|italien|italy/.test(city)) return 'Europe/Rome'
  if (/prag|prague|tschechien|czech/.test(city)) return 'Europe/Prague'
  if (/amsterdam|niederlande|netherlands/.test(city)) return 'Europe/Amsterdam'
  if (/madrid|spanien|spain/.test(city)) return 'Europe/Madrid'
  return null
}

function localClock(zone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'long', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find(item => item.type === type)?.value || ''
  return { weekday: weekdayIndex[part('weekday').toLowerCase()] ?? -1,
    minutes: Number(part('hour')) * 60 + Number(part('minute')) }
}

function plannedClock(date: string, time: string): { weekday: number; minutes: number } | null {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !/^\\d{2}:\\d{2}/.test(time)) return null
  const hour = Number(time.slice(0, 2)), minute = Number(time.slice(3, 5))
  if (hour > 23 || minute > 59) return null
  const day = new Date(date + 'T12:00:00Z')
  if (Number.isNaN(day.getTime())) return null
  return { weekday: day.getUTCDay(), minutes: hour * 60 + minute }
}

function parseIntervals(value: string): Array<[number, number]> | null {
  const normalized = value.toLowerCase().replace(/[–—−]/g, '-').trim()
  if (/^(closed|geschlossen|ruhetag|not open)$/.test(normalized)) return []
  if (/^(open 24 hours|24 hours|24 stunden|durchgehend geöffnet|24\/7)$/.test(normalized)) return [[0, 1440]]
  const pieces = normalized.split(/[,;]/)
  const intervals: Array<[number, number]> = []
  for (const piece of pieces) {
    const match = piece.trim().match(/^(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})$/)
    if (!match) return null
    const start = Number(match[1]) * 60 + Number(match[2])
    const end = Number(match[3]) * 60 + Number(match[4])
    if (Number(match[1]) > 23 || Number(match[3]) > 24 || Number(match[2]) > 59 || Number(match[4]) > 59 || start >= 1440 || end > 1440) return null
    intervals.push([start, end])
  }
  return intervals.length ? intervals : null
}

export function openingStatus(
  hours: string | null,
  destination: string | null | undefined,
  plannedDate?: string | null,
  plannedStart?: string | null,
): OpeningStatus {
  if (!hours?.trim()) return 'unknown'
  const zone = destinationTimeZone(destination)
  const clock = plannedDate && plannedStart ? plannedClock(plannedDate, plannedStart) : zone ? localClock(zone) : null
  if (!clock || clock.weekday < 0) return 'unknown'
  const schedule = new Map<number, Array<[number, number]>>()
  for (const line of hours.split(/\\n/)) {
    const match = line.trim().match(weekdayPattern)
    if (!match) continue
    const intervals = parseIntervals(match[2])
    if (intervals === null) return 'unknown'
    schedule.set(weekdayIndex[match[1].toLowerCase()], intervals)
  }
  // A partial schedule cannot establish the previous day's overnight hours.
  if (schedule.size !== 7) return 'unknown'
  const today = schedule.get(clock.weekday) || []
  const previous = schedule.get((clock.weekday + 6) % 7) || []
  if (today.some(([start, end]) => end > start && clock.minutes >= start && clock.minutes < end ||
    end <= start && clock.minutes >= start)) return 'open'
  if (previous.some(([start, end]) => end <= start && clock.minutes < end)) return 'open'
  return 'closed'
}
