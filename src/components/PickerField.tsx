import { parts, WEEKDAYS, weekday, type DateStr } from '../lib/date';

/** "09:00" → "오전 9:00", "15:30" → "오후 3:30" */
export const timeLabel = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
};

/** "2026-11-24" → "2026.11.24 (화)" */
export const dateLabel = (d: DateStr) => {
  const [y, m, day] = parts(d);
  return `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')} (${WEEKDAYS[weekday(d)]})`;
};

/**
 * Time/date field drawn by us, with the native input laid transparently on top so a tap
 * still opens the iOS picker. iOS ignores CSS height on native time/date inputs, which
 * made them taller than the selects next to them.
 */
export function PickerField({ type, value, onChange, label, disabled }: { type: 'time' | 'date'; value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`picker-field${disabled ? ' disabled' : ''}`}>
      <span>{type === 'time' ? timeLabel(value) : dateLabel(value)}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.(); // desktop browsers; iOS opens its picker on tap anyway
          } catch {
            /* not allowed here — the native tap behaviour still applies */
          }
        }}
        disabled={disabled}
        aria-label={label}
      />
    </label>
  );
}
