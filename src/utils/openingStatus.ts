export type OpeningStatus = 'open' | 'closed' | 'unknown'

// Opening hours currently arrive as human-readable Google weekday descriptions.
// Never treat an unrecognized schedule as closed.
const weekdayIndex: Record<string, number> = {
  sunday: 0, sonntag: 0, so: 0, monday: 1, montag: 1, mo: 1,
  tuesday: 2, dienstag: 2, di: 2, wednesday: 3, mittwoch: 3, mi: 3,
  thursday: 4, donnerstag: 4, do: 4, friday: 5, freitag: 5, fr: 5,
  saturday: 6, samstag: 6, sa: 6,
}
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(time)) return null
  const hour = Number(time.slice(0, 2)), minute = Number(time.slice(3, 5))
  if (hour > 23 || minute > 59) return null
  const day = new Date(date + 'T12:00:00Z')
  if (Number.isNaN(day.getTime())) return null
  return { weekday: day.getUTCDay(), minutes: hour * 60 + minute }
}

function clockMinutes(hourText: string, minuteText: string, period?: string): number | null {
  let hour = Number(hourText)
  const minute = Number(minuteText)
  if (minute > 59 || hour > 24) return null
  if (period) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (period.toLowerCase() === 'pm' ? 12 : 0)
  } else if (hour > 23 && !(hour === 24 && minute === 0)) return null
  return hour * 60 + minute
}

function parseIntervals(value: string): Array<[number, number]> | null {
  const normalized = value.toLowerCase().replace(/[–—−]/g, '-').replace(/\u202f|\u00a0/g, ' ').replace(/\s*uhr\s*$/i, '').trim()
  if (/^(closed|geschlossen|ruhetag|not open)$/.test(normalized)) return []
  if (/^(open 24 hours|24 hours|24 stunden|durchgehend geöffnet|24\/7|24 stunden geöffnet)$/.test(normalized)) return [[0, 1440]]
  const intervals: Array<[number, number]> = []
  for (const piece of normalized.split(/[,;]/)) {
    const match = piece.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
    if (!match) return null
    // In "9:00-6:00 PM", the AM/PM marker on the right is not enough
    // to determine the left side unambiguously; keep status unknown.
    if (Boolean(match[3]) !== Boolean(match[6])) return null
    const start = clockMinutes(match[1], match[2], match[3])
    const end = clockMinutes(match[4], match[5], match[6])
    if (start === null || end === null || start >= 1440 || end > 1440) return null
    // 00:00 at the end denotes midnight at the end of the day.
    intervals.push([start, end === 0 && start > 0 ? 1440 : end])
  }
  return intervals.length ? intervals : null
}

type Interval = [number, number]
const compactDay: Record<string, number> = {
  so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}
const dayToken = '(?:sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|so|mo|di|mi|do|fr|sa)'
const dayExpression = new RegExp('^(' + dayToken + ')(?:\\s*([-\\/])\\s*(' + dayToken + '))?\\s*:?[ \\t]+(.+)$', 'i')
const timeWindow = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi

function daysForExpression(first: string, separator?: string, last?: string): number[] {
  const from = weekdayIndex[first.toLowerCase()] ?? compactDay[first.toLowerCase()]
  if (from === undefined) return []
  if (!last) return [from]
  const to = weekdayIndex[last.toLowerCase()] ?? compactDay[last.toLowerCase()]
  if (to === undefined) return []
  if (separator === '/') return from === to ? [from] : [from, to]
  const days: number[] = []
  let day = from
  for (let count = 0; count < 7; count++) {
    days.push(day)
    if (day === to) break
    day = (day + 1) % 7
  }
  return days
}

function parseDayGroup(text: string): number[] | null {
  // A slash joins independent days and ranges: "Mo/Mi-Fr" = Mon, Wed, Thu, Fri.
  const days = new Set<number>()
  const token = '(?:' + dayToken.slice(3, -1) + ')'
  const groupPattern = new RegExp('^' + token + '(?:\\s*[-–—]\\s*' + token + ')?$', 'i')
  for (const part of text.split('/')) {
    const normalized = part.trim().replace(/[–—−]/g, '-')
    if (!groupPattern.test(normalized)) return null
    const pair = normalized.split(/\s*-\s*/)
    for (const day of daysForExpression(pair[0], pair.length > 1 ? '-' : undefined, pair[1])) days.add(day)
  }
  return [...days]
}

function scheduleForHours(hours: string): Map<number, Interval[]> | null {
  const schedule = new Map<number, Interval[]>()
  let hasNamedSections = false
  for (const raw of hours.split(/[\n·•]/)) {
    const segment = raw.trim()
    if (!segment) continue
    // Named offers (Garden, Wellness, Night bathing, Lunch/Dinner) can have
    // different admission rules. Do not merge them into an invented status.
    if (/^(?:garden|wellness|nachtbaden|night bathing|lunch|dinner)\s*:/i.test(segment)) {
      hasNamedSections = true
      continue
    }
    const daily = segment.match(/^(?:(?:bistro\/caf[eé]|restaurant|café|cafe)\s+)?(?:täglich|taeglich|jeden tag|daily|every day)\s*[:：]?\s*(.*)$/i)
    if (daily) {
      const window = daily[1].match(timeWindow)?.[0]
      if (!window) return null
      const intervals = parseIntervals(window)
      if (intervals === null) return null
      for (let day = 0; day < 7; day++) schedule.set(day, intervals)
      continue
    }
    const normalized = segment.replace(/[–—−]/g, '-')
    const grouped = normalized.match(/^([A-Za-zÄÖÜäöüß/\-\s]+?)\s+((?:\d{1,2}:\d{2})|geschlossen|closed|ruhetag)\b(.*)$/i)
    const match = normalized.match(dayExpression)
    if (!match && !grouped) continue
    const days = grouped ? parseDayGroup(grouped[1].trim()) : daysForExpression(match![1], match![2], match![3])
    if (!days?.length) return null
    const body = grouped ? (grouped[2] + grouped[3]).trim() : match![4].trim()
    const closed = /^(?:geschlossen|closed|ruhetag)\b/i.test(body)
    const windows = body.match(timeWindow) || []
    if (!closed && !windows.length) return null
    const intervals: Interval[] = []
    for (const window of windows) {
      const parsed = parseIntervals(window)
      if (parsed === null) return null
      intervals.push(...parsed)
    }
    for (const day of days) {
      const existing = schedule.get(day) || []
      schedule.set(day, closed ? [] : [...existing, ...intervals])
    }
  }
  if (hasNamedSections || schedule.size !== 7) return null
  return schedule
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
  const schedule = scheduleForHours(hours)
  if (!schedule) return 'unknown'
  const today = schedule.get(clock.weekday) || []
  const previous = schedule.get((clock.weekday + 6) % 7) || []
  if (today.some(([start, end]) => end > start && clock.minutes >= start && clock.minutes < end ||
    end <= start && clock.minutes >= start)) return 'open'
  if (previous.some(([start, end]) => end <= start && clock.minutes < end)) return 'open'
  return 'closed'
}
