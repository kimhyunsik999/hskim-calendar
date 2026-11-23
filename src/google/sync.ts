import { addDays, diffDays, type DateStr } from '../lib/date';
import {
  calKeyOf,
  effectiveShift,
  isWork,
  OFF_TITLES,
  SHIFT_CAL_NAMES,
  SHIFT_TITLES,
  shiftInterval,
  textOn,
  type Overrides,
  type Shift,
  type ShiftCalKey,
  type ShiftColors,
} from '../lib/shift';
import {
  allDay,
  createCalendar,
  deleteEvent,
  getCalendar,
  insertEvent,
  listCalendars,
  listEvents,
  listWriters,
  patchCalendar,
  patchEvent,
  setCalendarColor,
  shareCalendar,
  subscribeCalendar,
  tag,
  type GEvent,
} from './api';

export type ShiftCals = Record<ShiftCalKey, string>;
const KEYS: ShiftCalKey[] = ['A', 'B', 'C', '휴'];
/** The main shared calendar's description carries the ids of the 4 shift calendars, so both spouses find the same ones. */
const MARK = '[hskim-calendar] ';

function readMap(desc?: string): ShiftCals | null {
  const line = desc?.split('\n').find((l) => l.startsWith(MARK));
  if (!line) return null;
  try {
    const m = JSON.parse(line.slice(MARK.length));
    return KEYS.every((k) => typeof m[k] === 'string') ? (m as ShiftCals) : null;
  } catch {
    return null;
  }
}

/**
 * Make sure the 4 per-shift calendars (A/B/C/휴) exist, are in this user's list, and carry the chosen colors.
 * Created by the owner of the main calendar on first use; the spouse picks them up from the stored mapping.
 */
export async function ensureShiftCalendars(token: string, mainId: string, colors: ShiftColors): Promise<ShiftCals> {
  const [main, mine] = await Promise.all([getCalendar(token, mainId), listCalendars(token)]);
  let map = readMap(main.description);
  const listed = new Map(mine.map((c) => [c.id, c]));

  if (map) {
    for (const k of KEYS) if (!listed.has(map[k])) await subscribeCalendar(token, map[k]);
  } else {
    if (listed.get(mainId)?.accessRole !== 'owner') {
      throw new Error('공유 캘린더 소유자가 먼저 앱에서 "근무 일정 동기화"를 한 번 실행해야 합니다.');
    }
    const writers = await listWriters(token, mainId).catch(() => [] as string[]);
    const created = {} as ShiftCals;
    for (const k of KEYS) {
      const c = await createCalendar(token, SHIFT_CAL_NAMES[k], '4조 근무표 앱이 관리하는 근무 캘린더 (직접 수정하지 마세요)');
      created[k] = c.id;
      for (const w of writers) await shareCalendar(token, c.id, w);
    }
    const rest = (main.description ?? '').split('\n').filter((l) => !l.startsWith(MARK)).join('\n').trim();
    await patchCalendar(token, mainId, { description: (rest ? rest + '\n' : '') + MARK + JSON.stringify(created) });
    map = created;
  }

  // Colors are cosmetic: never let them block the sync. Google only accepts pure black/white foregrounds.
  await Promise.allSettled(
    KEYS.map((k) => setCalendarColor(token, map![k], colors[k], textOn(colors[k]) === '#ffffff' ? '#ffffff' : '#000000')),
  );
  return map;
}

/** Share the main calendar and all shift calendars with someone (writer). */
export async function shareAll(token: string, mainId: string, cals: ShiftCals | null, email: string) {
  await shareCalendar(token, mainId, email);
  if (cals) for (const k of KEYS) await shareCalendar(token, cals[k], email);
}

/** Read 근무 변경 (override) events from the main shared calendar. */
export async function fetchOverrides(token: string, calId: string, from: DateStr, to: DateStr) {
  const evs = await listEvents(token, calId, from, to, 'override');
  const map: Overrides = {};
  const ids: Record<DateStr, string> = {};
  for (const e of evs) {
    const d = e.start.date;
    const s = e.extendedProperties?.shared?.shift as Shift | undefined;
    if (d && s) {
      map[d] = s;
      ids[d] = e.id;
    }
  }
  return { map, ids };
}

/** Set (or clear with null) a 근무 변경 for one date, then re-sync that date's shift event. */
export async function setOverride(
  token: string,
  mainId: string,
  cals: ShiftCals,
  date: DateStr,
  shift: Shift | null,
  reminderMin: number,
) {
  const { ids } = await fetchOverrides(token, mainId, date, date);
  if (ids[date]) await deleteEvent(token, mainId, ids[date]);
  if (shift) {
    await insertEvent(token, mainId, {
      summary: `[근무변경] ${shift}`,
      ...allDay(date),
      ...tag('override', { shift, date }),
      reminders: { useDefault: false, overrides: [] },
    } as Partial<GEvent>);
  }
  await syncShifts(token, mainId, cals, date, date, reminderMin);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

function shiftBody(date: DateStr, s: Shift, reminderMin: number): Partial<GEvent> {
  const remind = String(reminderMin);
  if (isWork(s)) {
    const { start, end } = shiftInterval(date, s);
    return {
      summary: SHIFT_TITLES[s],
      start: { dateTime: start },
      end: { dateTime: end },
      transparency: 'opaque',
      reminders: { useDefault: false, overrides: reminderMin > 0 ? [{ method: 'popup', minutes: reminderMin }] : [] },
      ...tag('shift', { date, shift: s, remind }),
    };
  }
  return {
    summary: OFF_TITLES[s],
    ...allDay(date),
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [] },
    ...tag('shift', { date, shift: s, remind }),
  };
}

/**
 * Make the shift calendars contain exactly one event per day in [from, to] — a timed event with a
 * reminder for A/B/C, an all-day event for 휴/연차 — in the calendar matching that day's shift.
 * Idempotent. Also moves events left in the main calendar by older versions.
 */
export async function syncShifts(
  token: string,
  mainId: string,
  cals: ShiftCals,
  from: DateStr,
  to: DateStr,
  reminderMin: number,
  onProgress?: (done: number, total: number) => void,
) {
  const calIds = [mainId, ...KEYS.map((k) => cals[k])];
  const [{ map: overrides }, ...lists] = await Promise.all([
    fetchOverrides(token, mainId, from, to),
    // C shifts of `to` end the next day; widen so they are found. Events are keyed by their tagged date.
    ...calIds.map((id) => listEvents(token, id, addDays(from, -1), addDays(to, 1), 'shift').then((evs) => evs.map((e) => ({ e, cal: id })))),
  ]);

  const byDate = new Map<DateStr, { e: GEvent; cal: string }[]>();
  for (const x of lists.flat()) {
    const d = x.e.extendedProperties?.shared?.date;
    if (d && d >= from && d <= to) byDate.set(d, [...(byDate.get(d) ?? []), x]);
  }

  const jobs: (() => Promise<unknown>)[] = [];
  for (let i = 0, n = diffDays(to, from); i <= n; i++) {
    const date = addDays(from, i);
    const s = effectiveShift(date, overrides);
    const target = cals[calKeyOf(s)];
    const body = shiftBody(date, s, reminderMin);
    const found = byDate.get(date) ?? [];
    const keep = found.find((x) => x.cal === target);
    for (const x of found) if (x !== keep) jobs.push(() => deleteEvent(token, x.cal, x.e.id));
    if (!keep) {
      jobs.push(() => insertEvent(token, target, body));
      continue;
    }
    const sh = keep.e.extendedProperties?.shared;
    if (sh?.shift !== s || sh?.remind !== String(reminderMin) || keep.e.summary !== body.summary) {
      jobs.push(() => patchEvent(token, target, keep.e.id, body));
    }
  }

  let done = 0;
  onProgress?.(0, jobs.length);
  await pool(jobs, 2, async (job) => {
    await job();
    onProgress?.(++done, jobs.length);
  });
  return jobs.length;
}

export async function saveMonthMemo(token: string, calId: string, firstOfMonth: DateStr, text: string, existingId?: string) {
  if (existingId) {
    if (!text.trim()) return deleteEvent(token, calId, existingId);
    return patchEvent(token, calId, existingId, { description: text });
  }
  if (!text.trim()) return;
  return insertEvent(token, calId, {
    summary: '📝 월별 메모',
    description: text,
    ...allDay(firstOfMonth),
    ...tag('monthMemo', { month: firstOfMonth.slice(0, 7) }),
    reminders: { useDefault: false, overrides: [] },
  } as Partial<GEvent>);
}
