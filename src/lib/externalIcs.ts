// External (iCloud etc.) calendars via their public ICS link, fetched through our CORS proxy (worker/).
import type { CalEvent } from '../google/api';
import { addDays, dateInSeoul, timeInSeoul, ymd, type DateStr } from './date';

export type ExtCal = { id: string; name: string; url: string; color: string };

export const ICS_PROXY: string = import.meta.env.VITE_ICS_PROXY ?? '';

/** webcal:// → https:// (iCloud "공개 캘린더" links are webcal). */
export const normalizeIcsUrl = (u: string) => u.trim().replace(/^webcal:\/\//i, 'https://');

type ICALTime = { isDate: boolean; year: number; month: number; day: number; toJSDate(): Date };

function point(t: ICALTime): { ms: number; date: DateStr; time?: string } {
  if (t.isDate) {
    const date = ymd(t.year, t.month, t.day);
    return { ms: Date.parse(`${date}T00:00:00+09:00`), date };
  }
  const d = t.toJSDate();
  return { ms: d.getTime(), date: dateInSeoul(d), time: timeInSeoul(d) };
}

/** Parse an ICS feed into events overlapping [from, to] (Korea dates), expanding recurrences. */
export async function parseIcs(text: string, cal: ExtCal, from: DateStr, to: DateStr): Promise<CalEvent[]> {
  const { default: ICAL } = await import('ical.js');
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* malformed tz — times fall back to UTC/floating */
    }
  }
  const all = root.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v));
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>();
  for (const e of all) if (!e.isRecurrenceException()) masters.set(e.uid, e);
  for (const e of all) if (e.isRecurrenceException()) masters.get(e.uid)?.relateException(e);

  const rangeStart = Date.parse(`${from}T00:00:00+09:00`);
  const rangeEnd = Date.parse(`${addDays(to, 1)}T00:00:00+09:00`);
  const out: CalEvent[] = [];

  const add = (uid: string, summary: string, s: ICALTime, e: ICALTime | null) => {
    const a = point(s);
    const b = e ? point(e) : a;
    const endMs = e ? b.ms : a.ms + (s.isDate ? 86_400_000 : 0);
    if (a.ms >= rangeEnd || endMs <= rangeStart) return;
    let end: DateStr;
    if (s.isDate) end = e ? addDays(b.date, -1) : a.date;
    else end = b.ms > a.ms ? dateInSeoul(new Date(b.ms - 1)) : a.date;
    if (end < a.date) end = a.date;
    out.push({
      id: `${uid}@${a.ms}`,
      calendarId: cal.id,
      calendarName: cal.name,
      title: summary || '(제목 없음)',
      start: a.date,
      end,
      allDay: s.isDate,
      time: a.time,
      color: cal.color,
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      add(ev.uid, ev.summary, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    for (let n = 0, next = it.next(); next && n < 20_000; n++, next = it.next()) {
      const d = ev.getOccurrenceDetails(next);
      if (point(d.startDate).ms >= rangeEnd) break;
      add(ev.uid, d.item.summary, d.startDate, d.endDate);
    }
  }
  return out;
}

export async function fetchExternal(cal: ExtCal, from: DateStr, to: DateStr, fresh = false): Promise<CalEvent[]> {
  if (!ICS_PROXY) throw new Error('iCloud 중계 서버 주소가 설정되지 않았습니다.');
  const r = await fetch(`${ICS_PROXY}?url=${encodeURIComponent(normalizeIcsUrl(cal.url))}${fresh ? `&fresh=${Date.now()}` : ''}`, fresh ? { cache: 'no-store' } : undefined);
  if (!r.ok) throw new Error(`${cal.name}: 캘린더를 불러오지 못했습니다 (${r.status})`);
  return parseIcs(await r.text(), cal, from, to);
}
