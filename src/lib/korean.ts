import KoreanLunarCalendar from 'korean-lunar-calendar';
import { getHolidayPreset } from '@hyunbinseo/holidays-kr';
import { parts, pad, type DateStr } from './date';

const lunarCal = new KoreanLunarCalendar();

export function lunarOf(date: DateStr): { month: number; day: number; leap: boolean } | null {
  const [y, m, d] = parts(date);
  if (!lunarCal.setSolarDate(y, m, d)) return null;
  const l = lunarCal.getLunarCalendar();
  return { month: l.month, day: l.day, leap: !!l.intercalation };
}

/** Lunar label like the source app: shown only on lunar 1st and 15th, e.g. "11.01", "10.15". */
export function lunarLabel(date: DateStr): string | null {
  const l = lunarOf(date);
  if (!l || (l.day !== 1 && l.day !== 15)) return null;
  return `${l.leap ? '윤' : ''}${l.month}.${pad(l.day)}`;
}

const RENAME: Record<string, string> = { 기독탄신일: '성탄절', '1월 1일': '1월1일' };

export type HolidayMap = Record<DateStr, { name: string; off: boolean }>;

/** Non-holiday observances shown in the source app (gray, not red). MM-DD. */
const OBSERVANCES: Record<string, string> = {
  '04-05': '식목일',
  '05-08': '어버이날',
  '05-15': '스승의날',
  '10-01': '국군의날',
  '11-09': '소방의날',
};

const cache = new Map<number, Promise<HolidayMap>>();

export function holidaysOf(year: number): Promise<HolidayMap> {
  let p = cache.get(year);
  if (!p) {
    p = (async () => {
      const map: HolidayMap = {};
      for (const [md, name] of Object.entries(OBSERVANCES)) map[`${year}-${md}`] = { name, off: false };
      try {
        const preset = await getHolidayPreset(String(year));
        for (const [date, names] of Object.entries(preset)) {
          map[date] = { name: names.map((n) => RENAME[n] ?? n).join(', '), off: true };
        }
      } catch {
        // Year not covered by the dataset yet — observances only.
      }
      return map;
    })();
    cache.set(year, p);
  }
  return p;
}
