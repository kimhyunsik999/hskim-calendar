import { describe, expect, it } from 'vitest';
import { normalizeIcsUrl, parseIcs } from './externalIcs';

const CAL = { id: 'ext:fam', name: '가족', url: 'webcal://p01-caldav.icloud.com/published/2/x', color: '#e03131' };

// Shape of an iCloud published calendar: VTIMEZONE + timed, all-day, multi-day, weekly recurring w/ exception & EXDATE.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iCloud//EN
BEGIN:VTIMEZONE
TZID:Asia/Seoul
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
TZNAME:KST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:timed-1
DTSTART;TZID=Asia/Seoul:20261127T120000
DTEND;TZID=Asia/Seoul:20261127T130000
SUMMARY:수호 분당차 약
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20261108
DTEND;VALUE=DATE:20261111
SUMMARY:혜연연차
END:VEVENT
BEGIN:VEVENT
UID:utc-1
DTSTART:20261130T230000Z
DTEND:20261201T000000Z
SUMMARY:UTC 일정
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
DTSTART;TZID=Asia/Seoul:20261102T090000
DTEND;TZID=Asia/Seoul:20261102T100000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Asia/Seoul:20261116T090000
SUMMARY:주간 회의
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
RECURRENCE-ID;TZID=Asia/Seoul:20261109T090000
DTSTART;TZID=Asia/Seoul:20261110T090000
DTEND;TZID=Asia/Seoul:20261110T100000
SUMMARY:주간 회의 (화요일로 변경)
END:VEVENT
BEGIN:VEVENT
UID:old-1
DTSTART;VALUE=DATE:20250101
DTEND;VALUE=DATE:20250102
SUMMARY:범위 밖
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

describe('external ICS', () => {
  it('normalizes webcal links', () => {
    expect(normalizeIcsUrl(' webcal://p01-caldav.icloud.com/x ')).toBe('https://p01-caldav.icloud.com/x');
  });

  it('parses timed, all-day, UTC and recurring events within range', async () => {
    const evs = await parseIcs(ICS, CAL, '2026-11-01', '2026-12-05');
    const s = (title: string) => evs.filter((e) => e.title.startsWith(title)).map((e) => `${e.start}~${e.end} ${e.time ?? '종일'} ${e.title}`);
    expect(s('수호')).toEqual(['2026-11-27~2026-11-27 12:00 수호 분당차 약']);
    expect(s('혜연')).toEqual(['2026-11-08~2026-11-10 종일 혜연연차']);
    expect(s('UTC')).toEqual(['2026-12-01~2026-12-01 08:00 UTC 일정']); // 23:00Z = 08:00 KST next day
    expect(s('주간 회의')).toEqual([
      '2026-11-02~2026-11-02 09:00 주간 회의',
      '2026-11-10~2026-11-10 09:00 주간 회의 (화요일로 변경)', // moved occurrence
      // 11-16 excluded by EXDATE
      '2026-11-23~2026-11-23 09:00 주간 회의',
      '2026-11-30~2026-11-30 09:00 주간 회의',
    ]);
    expect(evs.some((e) => e.title === '범위 밖')).toBe(false);
    expect(evs.every((e) => e.color === CAL.color && e.calendarName === '가족')).toBe(true);
  });
});
