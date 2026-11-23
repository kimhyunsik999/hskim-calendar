import { daysInMonth, weekday, ymd } from '../lib/date';
import type { HolidayMap } from '../lib/korean';
import { effectiveShift, isWork, SHIFT_OPTIONS, type Overrides, type Shift } from '../lib/shift';
import { Sheet } from './Sheet';
import { ShiftBadge } from './ShiftBadge';

export function StatsSheet({ y, m, overrides, holidays, onClose }: { y: number; m: number; overrides: Overrides; holidays: HolidayMap; onClose: () => void }) {
  const count = Object.fromEntries(SHIFT_OPTIONS.map((s) => [s, 0])) as Record<Shift, number>;
  let holidayWork = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = ymd(y, m, d);
    const s = effectiveShift(date, overrides);
    count[s]++;
    if (isWork(s) && (holidays[date]?.off || weekday(date) === 0 || weekday(date) === 6)) holidayWork++;
  }
  const work = count.A + count.B + count.C;
  return (
    <Sheet title={`${y}년 ${m}월 근무 통계`} onClose={onClose}>
      <div className="stats">
        {SHIFT_OPTIONS.map((s) => (
          <div key={s} className="stat">
            <ShiftBadge shift={s} />
            <b>{count[s]}일</b>
          </div>
        ))}
      </div>
      <ul className="stat-list">
        <li>
          근무일 <b>{work}일</b> · 근무시간 <b>{work * 8}시간</b>
        </li>
        <li>
          야간(C) <b>{count.C}일</b>
        </li>
        <li>
          주말·공휴일 근무 <b>{holidayWork}일</b>
        </li>
      </ul>
    </Sheet>
  );
}
