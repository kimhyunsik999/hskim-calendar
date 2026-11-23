import { addDays, diffDays, type DateStr } from '../lib/date';
import { effectiveShift, isWork, shiftInterval, SHIFT_TIMES, type Overrides, type Shift } from '../lib/shift';
import { allDay, deleteEvent, insertEvent, listEvents, patchEvent, tag, type GEvent } from './api';

/** Read 근무 변경 (override) events from the shared calendar. */
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
export async function setOverride(token: string, calId: string, date: DateStr, shift: Shift | null, reminderMin: number) {
  const { ids } = await fetchOverrides(token, calId, date, date);
  if (ids[date]) await deleteEvent(token, calId, ids[date]);
  if (shift) {
    await insertEvent(token, calId, {
      summary: `[근무변경] ${shift}`,
      ...allDay(date),
      ...tag('override', { shift, date }),
      reminders: { useDefault: false, overrides: [] },
    } as Partial<GEvent>);
  }
  await syncShifts(token, calId, date, date, reminderMin);
}

const shiftSummary = (s: keyof typeof SHIFT_TIMES) => `${s} 근무 (${SHIFT_TIMES[s].start}-${SHIFT_TIMES[s].end})`;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Make the shared calendar contain exactly one timed event per work day in [from, to],
 * reflecting overrides, with a popup reminder `reminderMin` minutes before (0 = none).
 * Idempotent: unchanged days are left alone.
 */
export async function syncShifts(
  token: string,
  calId: string,
  from: DateStr,
  to: DateStr,
  reminderMin: number,
  onProgress?: (done: number, total: number) => void,
) {
  const [{ map: overrides }, existing] = await Promise.all([
    fetchOverrides(token, calId, from, to),
    // C shifts of `to` end the next day; widen so they are found. Shift events are keyed by their tagged date.
    listEvents(token, calId, addDays(from, -1), addDays(to, 1), 'shift'),
  ]);
  const byDate = new Map<DateStr, GEvent[]>();
  for (const e of existing) {
    const d = e.extendedProperties?.shared?.date;
    if (d && d >= from && d <= to) byDate.set(d, [...(byDate.get(d) ?? []), e]);
  }

  const jobs: (() => Promise<unknown>)[] = [];
  const remind = String(reminderMin);
  for (let i = 0, n = diffDays(to, from); i <= n; i++) {
    const date = addDays(from, i);
    const s = effectiveShift(date, overrides);
    const [cur, ...dupes] = byDate.get(date) ?? [];
    dupes.forEach((d) => jobs.push(() => deleteEvent(token, calId, d.id)));
    if (!isWork(s)) {
      if (cur) jobs.push(() => deleteEvent(token, calId, cur.id));
      continue;
    }
    const { start, end } = shiftInterval(date, s);
    const body: Partial<GEvent> = {
      summary: shiftSummary(s),
      start: { dateTime: start },
      end: { dateTime: end },
      reminders: { useDefault: false, overrides: reminderMin > 0 ? [{ method: 'popup', minutes: reminderMin }] : [] },
      ...tag('shift', { date, shift: s, remind }),
    };
    const sh = cur?.extendedProperties?.shared;
    if (!cur) jobs.push(() => insertEvent(token, calId, body));
    else if (sh?.shift !== s || sh?.remind !== remind) jobs.push(() => patchEvent(token, calId, cur.id, body));
  }

  let done = 0;
  onProgress?.(0, jobs.length);
  await pool(jobs, 4, async (job) => {
    await job();
    onProgress?.(++done, jobs.length);
  });
  return jobs.length;
}

export async function saveMonthMemo(
  token: string,
  calId: string,
  firstOfMonth: DateStr,
  text: string,
  existingId?: string,
) {
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
