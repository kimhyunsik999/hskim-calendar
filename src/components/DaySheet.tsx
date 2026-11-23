import { useState } from 'react';
import type { CalEvent } from '../google/api';
import { addDays, parts, WEEKDAYS, weekday, type DateStr } from '../lib/date';
import { describe, icon, isAlert, leaveTime, shiftWeather, type Forecast, type Hour } from '../lib/weather';
import { lunarOf, type HolidayMap } from '../lib/korean';
import { baseShift, effectiveShift, isWork, SHIFT_OPTIONS, SHIFT_TIMES, type Overrides, type Shift } from '../lib/shift';
import type { ICloudCal } from '../lib/icloud';
import { Sheet } from './Sheet';
import { ShiftBadge } from './ShiftBadge';

/** target: 'google' (shared 4조 calendar) or 'icloud:<calendar url>'. No time = all-day. */
export type NewEventInput = { title: string; target: string; time?: string; minutes?: number };

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
  onAddMemo: (date: DateStr, ev: NewEventInput) => void;
  icloudCals: ICloudCal[];
  onDelete: (ev: CalEvent) => void;
  onUpdate: (ev: CalEvent, x: EditInput) => void;
  /** null = editable; otherwise why not (shown when tapped). */
  whyNotEditable: (ev: CalEvent) => string | null;
  homeWx: Forecast | null;
  workWx: Forecast | null;
  places: { home?: string; work?: string };
};

/** Result of editing an existing event. No time = all-day. */
export type EditInput = { title: string; date: DateStr; time?: string; minutes?: number };

function EventEditor({ ev, busy, onSave, onDelete, onCancel }: { ev: CalEvent; busy: boolean; onSave: (x: EditInput) => void; onDelete: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(ev.title);
  const [date, setDate] = useState(ev.start);
  const [allDay, setAllDay] = useState(ev.allDay);
  const [time, setTime] = useState(ev.time ?? '09:00');
  const [minutes, setMinutes] = useState(ev.minutes && ev.minutes > 0 ? ev.minutes : 60);
  const durations = [...new Set([30, 60, 90, 120, 180, 240, minutes])].sort((a, b) => a - b);
  return (
    <form
      className="ev-edit"
      style={{ ['--c' as string]: ev.color }}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave({ title: title.trim(), date, time: allDay ? undefined : time, minutes: allDay ? undefined : minutes });
      }}
    >
      <div className="muted small">{ev.calendarName} 일정 수정</div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목" />
      <div className="add-row">
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="날짜" />
        <label className="allday">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          종일
        </label>
      </div>
      {!allDay && (
        <div className="add-row">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} aria-label="시작 시간" />
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="소요 시간">
            {durations.map((n) => (
              <option key={n} value={n}>
                {n < 60 ? `${n}분` : n % 60 ? `${Math.floor(n / 60)}시간 ${n % 60}분` : `${n / 60}시간`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="add-row">
        <button type="button" className="btn ghost" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
          삭제
        </button>
        <button className="btn grow" disabled={busy || !title.trim()}>
          저장
        </button>
      </div>
    </form>
  );
}

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
  const wx = shiftWeather(p.homeWx, p.workWx, date, shift, addDays(date, 1));
  const [editing, setEditing] = useState<string | null>(null);
  const [hint, setHint] = useState<{ key: string; text: string } | null>(null);
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [time, setTime] = useState('09:00');
  const [minutes, setMinutes] = useState(60);
  const [target, setTarget] = useState(() => {
    const last = localStorage.getItem('hc.lastTarget') ?? 'google';
    return last === 'google' || p.icloudCals.some((c) => `icloud:${c.id}` === last) ? last : 'google';
  });
  const pickTarget = (v: string) => {
    setTarget(v);
    try {
      localStorage.setItem('hc.lastTarget', v);
    } catch {
      /* ignore */
    }
  };

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
          <h3>출퇴근 날씨</h3>
          {isWork(shift) ? (
            <>
              {wx.leave && <WxLine label={`🏠 출근 출발 ${leaveTime(shift)} · ${p.places.home ?? '집'}`} h={wx.leave} />}
              {wx.off && (
                <WxLine label={`🏭 퇴근 ${SHIFT_TIMES[shift].end}${shift === 'C' ? '(다음날)' : ''} · ${p.places.work ?? '회사'}`} h={wx.off} />
              )}
            </>
          ) : (
            wx.leave && <WxLine label={`🏠 낮 12시 · ${p.places.home ?? '집'}`} h={wx.leave} />
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
          {dayEvents.map((e) => {
            const key = e.calendarId + e.id;
            if (editing === key)
              return (
                <li key={key} className="editing">
                  <EventEditor
                    ev={e}
                    busy={p.busy}
                    onCancel={() => setEditing(null)}
                    onDelete={() => {
                      setEditing(null);
                      p.onDelete(e);
                    }}
                    onSave={(x) => {
                      setEditing(null);
                      p.onUpdate(e, x);
                    }}
                  />
                </li>
              );
            const why = p.whyNotEditable(e);
            return (
              <li
                key={key}
                style={{ ['--c' as string]: e.color }}
                className={why ? '' : 'tappable'}
                onClick={() => (why ? setHint({ key, text: why }) : (setEditing(key), setHint(null)))}
              >
                <i className="bar" />
                <div>
                  <div>{e.title}</div>
                  <div className="muted">
                    {e.allDay ? (e.start === e.end ? '종일' : `${e.start.slice(5)} ~ ${e.end.slice(5)}`) : e.time} · {e.calendarName}
                    {e.recurring && ' · 🔁'}
                  </div>
                  {hint?.key === key && <div className="muted small">{hint.text}</div>}
                </div>
                {!why && <span className="edit-mark" aria-hidden="true">✏️</span>}
              </li>
            );
          })}
        </ul>
        <form
          className="add-ev"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            p.onAddMemo(date, { title: title.trim(), target, time: allDay ? undefined : time, minutes: allDay ? undefined : minutes });
            setTitle('');
          }}
        >
          <input placeholder="일정 추가" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!p.canEdit} />
          <div className="add-row">
            <select value={target} onChange={(e) => pickTarget(e.target.value)} disabled={!p.canEdit} aria-label="저장할 캘린더">
              <option value="google">📅 4조 근무표 (공유)</option>
              {p.icloudCals.map((c) => (
                <option key={c.id} value={`icloud:${c.id}`}>
                  ☁️ {c.name}
                </option>
              ))}
            </select>
            <label className="allday">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={!p.canEdit} />
              종일
            </label>
          </div>
          {!allDay && (
            <div className="add-row">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} disabled={!p.canEdit} aria-label="시작 시간" />
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!p.canEdit} aria-label="소요 시간">
                {[30, 60, 90, 120, 180, 240].map((n) => (
                  <option key={n} value={n}>
                    {n < 60 ? `${n}분` : `${n / 60}시간`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button className="btn wide" disabled={!p.canEdit || p.busy || !title.trim()}>
            추가
          </button>
        </form>
        {!p.canEdit && <p className="muted">메모와 근무 변경은 설정(☰)에서 Google 연결 및 공유 캘린더를 지정하면 사용할 수 있습니다.</p>}
      </section>
    </Sheet>
  );
}
