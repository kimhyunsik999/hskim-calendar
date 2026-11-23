import type { Shift } from '../lib/shift';

const CLS: Record<Shift, string> = { A: 'sa', B: 'sb', C: 'sc', 휴: 'off', 연차: 'leave' };

export function ShiftBadge({ shift, changed, big }: { shift: Shift; changed?: boolean; big?: boolean }) {
  return (
    <span className={`badge ${CLS[shift]}${big ? ' big' : ''}${changed ? ' changed' : ''}`}>
      {shift === '연차' ? '연' : shift}
    </span>
  );
}
