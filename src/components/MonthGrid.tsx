import { useMemo } from 'react';
import type { CalEvent } from '../google/api';
import { diffDays, parts, weekday, type DateStr } from '../lib/date';
import type { HolidayMap } from '../lib/korean';
import { lunarLabel } from '../lib/korean';
import { effectiveShift, type Overrides } from '../lib/shift';
import { ShiftBadge } from './ShiftBadge';

const MAX_LANES = 4;

type Seg = { ev: CalEvent; s: number; e: number; lane: number; contLeft: boolean };

function layoutWeek(days: DateStr[], events: CalEvent[]) {
  const ws = days[0];
  const we = days[6];
  const evs = events
    .filter((e) => e.end >= ws && e.start <= we)
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        diffDays(b.end, b.start) - diffDays(a.end, a.start) ||
        Number(b.allDay) - Number(a.allDay) ||
        (a.time ?? '').localeCompare(b.time ?? ''),
    );
  const laneEnd: number[] = [];
  const segs: Seg[] = [];
  const hidden = Array(7).fill(0) as number[];
  for (const ev of evs) {
    const s = Math.max(0, diffDays(ev.start, ws));
    const e = Math.min(6, diffDays(ev.end, ws));
    let lane = laneEnd.findIndex((end) => end < s);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = e;
    if (lane < MAX_LANES) segs.push({ ev, s, e, lane, contLeft: ev.start < ws });
    else for (let c = s; c <= e; c++) hidden[c]++;
  }
  return { segs, hidden };
}

type Props = {
  month: number;
  days: DateStr[];
  todayStr: DateStr;
  events: CalEvent[];
  overrides: Overrides;
  holidays: HolidayMap;
  onPick: (d: DateStr) => void;
};

export function MonthGrid({ month, days, todayStr, events, overrides, holidays, onPick }: Props) {
  const weeks = useMemo(() => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);

  return (
    <div className="grid" style={{ ['--weeks' as string]: weeks.length }}>
      {weeks.map((w) => {
        const { segs, hidden } = layoutWeek(w, events);
        return (
          <div className="week" key={w[0]}>
            <div className="week-bg">
              {w.map((d) => (
                <button
                  key={d}
                  className={'cell' + (d === todayStr ? ' today' : '')}
                  onClick={() => onPick(d)}
                  aria-label={d}
                />
              ))}
            </div>
            <div className="week-fg">
              {w.map((d, i) => {
                const [, m, day] = parts(d);
                const out = m !== month;
                const hol = holidays[d];
                const wd = weekday(d);
                const numCls =
                  'num' + (hol?.off || wd === 0 ? ' red' : wd === 6 ? ' blue' : '') + (d === todayStr ? ' is-today' : '');
                const right = hol?.name ?? lunarLabel(d);
                return (
                  <div key={d} className={'head' + (out ? ' out' : '')} style={{ gridColumn: i + 1, gridRow: 1 }}>
                    <span className={numCls}>{day}</span>
                    {right && <span className={'aux' + (hol?.off ? ' red' : '')}>{right}</span>}
                  </div>
                );
              })}
              {w.map((d, i) => (
                <div
                  key={'b' + d}
                  className={'badge-wrap' + (parts(d)[1] !== month ? ' out' : '')}
                  style={{ gridColumn: i + 1, gridRow: 2 }}
                >
                  <ShiftBadge shift={effectiveShift(d, overrides)} changed={!!overrides[d]} />
                </div>
              ))}
              {segs.map(({ ev, s, e, lane, contLeft }) => (
                <div
                  key={ev.calendarId + ev.id + s}
                  className={'ev' + (parts(w[s])[1] !== month ? ' out' : '')}
                  style={{
                    gridColumn: `${s + 1} / ${e + 2}`,
                    gridRow: lane + 3,
                    ['--c' as string]: ev.color,
                  }}
                  title={ev.title}
                >
                  {!contLeft && <i className="bar" />}
                  <span>{ev.title}</span>
                </div>
              ))}
              {hidden.map((n, i) =>
                n ? (
                  <div key={'h' + i} className="more" style={{ gridColumn: i + 1, gridRow: MAX_LANES + 3 }}>
                    +{n}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
