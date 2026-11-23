import { addDays, diffDays, type DateStr } from './date';
import { baseShift, isWork, shiftInterval, SHIFT_TITLES } from './shift';

const stamp = (iso: string) => iso.slice(0, 19).replace(/[-:]/g, ''); // 2026-11-05T07:00:00 -> 20261105T070000

/**
 * iCalendar feed of the base 4조 rotation (no personal overrides — those live in Google).
 * Subscribable from iPhone 캘린더 / Google Calendar as a fallback.
 */
export function buildShiftIcs(from: DateStr, to: DateStr, alarmMinutes = 0): string {
  const L: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//hskim-calendar//4조 근무표//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:4조 근무표',
    'X-WR-TIMEZONE:Asia/Seoul',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Seoul',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:KST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  for (let i = 0, n = diffDays(to, from); i <= n; i++) {
    const date = addDays(from, i);
    const s = baseShift(date);
    if (!isWork(s)) continue;
    const { start, end } = shiftInterval(date, s);
    L.push(
      'BEGIN:VEVENT',
      `UID:${date}-4jo@hskim-calendar`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Asia/Seoul:${stamp(start)}`,
      `DTEND;TZID=Asia/Seoul:${stamp(end)}`,
      `SUMMARY:${SHIFT_TITLES[s]}`,
      'TRANSP:OPAQUE',
    );
    if (alarmMinutes > 0) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${s} 근무`, `TRIGGER:-PT${alarmMinutes}M`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
