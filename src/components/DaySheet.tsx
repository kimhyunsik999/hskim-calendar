import { useState } from 'react';
import type { CalEvent } from '../google/api';
import { addDays, parts, WEEKDAYS, weekday, type DateStr } from '../lib/date';
import { describe, icon, isAlert, shiftWeather, type Forecast, type Hour } from '../lib/weather';
import { lunarOf, type HolidayMap } from '../lib/korean';
import { baseShift, effectiveShift, isWork, SHIFT_OPTIONS, SHIFT_TIMES, type Overrides, type Shift } from '../lib/shift';
import { Sheet } from './Sheet';
import { ShiftBadge } from './ShiftBadge';

type Props = {
  date: DateStr;
  events: CalEvent[];
  overrides: Overrides;
  holidays: HolidayMap;
  sharedCalId: string | null;
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onOverride: (date: DateStr, s: Shift | null) => void;
  onAddMemo: (date: DateStr, title: string, time: string) => void;
  onDelete: (ev: CalEvent) => void;
  forecast: Forecast | null;
  weatherPlace?: string;
};

function WxLine({ label, h }: { label: string; h: Hour }) {
  return (
    <div className={isAlert(h) ? 'alert' : ''}>
      {icon(h.code, h.day)} {label} · {describe(h.code)} {Math.round(h.t)}° · 강수 {h.p}%
    </div>
  );
}

export function DaySheet(p: Props) {
  const { date } = p;
  const [, m, d] = parts(date);
  const shift = effectiveShift(date, p.overrides);
  const base = baseShift(date);
  const lunar = lunarOf(date);
  const hol = p.holidays[date];
  const dayEvents = p.events
    .filter((e) => e.start <= date && e.end >= date)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.time ?? '').localeCompare(b.time ?? ''));
  const wx = shiftWeather(p.forecast, date, shift, addDays(date, 1));
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');

  return (
    <Sheet
      title={
        <>
          {m}월 {d}일 ({WEEKDAYS[weekday(date)]})
          <small>
            {lunar && ` 음 ${lunar.leap ? '윤' : ''}${lunar.month}.${lunar.day}`}
            {hol && ` · ${hol.name}`}
          </small>
        </>
      }
      onClose={p.onClose}
    >
      <section className="day-shift">
        <ShiftBadge shift={shift} big changed={!!p.overrides[date]} />
        <div>
          <strong>{isWork(shift) ? `${shift} ${SHIFT_TIMES[shift].label}` : shift}</strong>
          <div className="muted">
            {isWork(shift) ? `${SHIFT_TIMES[shift].start} – ${SHIFT_TIMES[shift].end}${shift === 'C' ? ' (다음날)' : ''}` : '근무 없음'}
            {p.overrides[date] && ` · 기본 ${base}에서 변경`}
          </div>
        </div>
      </section>

      {wx && (
        <section className="day-wx">
          <h3>날씨{p.weatherPlace ? ` · ${p.weatherPlace}` : ''}</h3>
          {isWork(shift) ? (
            <>
              <WxLine label={`출근 ${SHIFT_TIMES[shift].start}`} h={wx.start} />
              {wx.end && <WxLine label={`퇴근 ${SHIFT_TIMES[shift].end}${shift === 'C' ? ' (다음날)' : ''}`} h={wx.end} />}
            </>
          ) : (
            <WxLine label="낮 12시" h={wx.start} />
          )}
        </section>
      )}

      <section>
        <h3>근무 변경</h3>
        <div className="chips">
          <button className={'chip' + (!p.overrides[date] ? ' on' : '')} disabled={!p.canEdit || p.busy} onClick={() => p.onOverride(date, null)}>
            기본({base})
          </button>
          {SHIFT_OPTIONS.map((s) => (
            <button
              key={s}
              className={'chip' + (p.overrides[date] === s ? ' on' : '')}
              disabled={!p.canEdit || p.busy}
              onClick={() => p.onOverride(date, s)}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>일정</h3>
        {dayEvents.length === 0 && <p className="muted">일정이 없습니다.</p>}
        <ul className="ev-list">
          {dayEvents.map((e) => (
            <li key={e.calendarId + e.id} style={{ ['--c' as string]: e.color }}>
              <i className="bar" />
              <div>
                <div>{e.title}</div>
                <div className="muted">
                  {e.allDay ? (e.start === e.end ? '종일' : `${e.start.slice(5)} ~ ${e.end.slice(5)}`) : e.time} · {e.calendarName}
                </div>
              </div>
              {e.calendarId === p.sharedCalId && (
                <button className="icon-btn" disabled={p.busy} onClick={() => p.onDelete(e)} aria-label="삭제">
                  🗑
                </button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="add-memo"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            p.onAddMemo(date, title.trim(), time);
            setTitle('');
            setTime('');
          }}
        >
          <input placeholder="메모·일정 추가" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!p.canEdit} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!p.canEdit} aria-label="시간 (비우면 종일)" />
          <button className="btn" disabled={!p.canEdit || p.busy || !title.trim()}>
            추가
          </button>
        </form>
        {!p.canEdit && <p className="muted">메모와 근무 변경은 설정(☰)에서 Google 연결 및 공유 캘린더를 지정하면 사용할 수 있습니다.</p>}
      </section>
    </Sheet>
  );
}
