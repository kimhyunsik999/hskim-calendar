import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

const CLOSE_DIST = 110; // px dragged that closes on release
const CLOSE_SPEED = 0.5; // px/ms flick that closes on release
const EASE = 'cubic-bezier(.32,.72,0,1)'; // iOS sheet curve

type Side = 'bottom' | 'left';

/**
 * Modal panel with iOS-style drag-to-dismiss.
 * - bottom: a sheet; pull down on the header — or on the body once it is scrolled to
 *   the top — and it follows the finger, then slides away (or springs back).
 * - left: a drawer; swipe it back to the left anywhere to close.
 * Backdrop tap, ✕ and Esc close with the same slide. Touches never reach the page behind.
 */
export function Sheet({ title, onClose, children, side = 'bottom' }: { title: ReactNode; onClose: () => void; children: ReactNode; side?: Side }) {
  const backRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const left = side === 'left';

  const hidden = left ? 'translateX(-100%)' : 'translateY(100%)';

  /** Slide in on mount: start off-screen, then transition in on the next frame. */
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const back = backRef.current;
    const dim = dimRef.current;
    if (!sheet || !back || !dim) return;
    sheet.style.transition = 'none';
    sheet.style.transform = hidden;
    dim.style.transition = 'none';
    dim.style.opacity = '0';
    void sheet.offsetWidth; // commit the start state
    const id = requestAnimationFrame(() => {
      if (closing.current) return;
      sheet.style.transition = `transform .36s ${EASE}`;
      sheet.style.transform = '';
      dim.style.transition = 'opacity .3s';
      dim.style.opacity = '1';
    });
    return () => cancelAnimationFrame(id);
  }, [hidden]);

  /** Slide the panel out, then actually close. */
  const dismiss = useCallback(() => {
    const sheet = sheetRef.current;
    const back = backRef.current;
    const dim = dimRef.current;
    if (closing.current) return;
    closing.current = true;
    if (!sheet || !back || !dim) return closeRef.current();
    sheet.style.transition = `transform .28s ${EASE}`;
    sheet.style.transform = hidden;
    dim.style.transition = 'opacity .28s';
    dim.style.opacity = '0';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closeRef.current();
    };
    // Only the panel's own transform ends the close (child transitions bubble up too).
    const onEnd = (e: TransitionEvent) => {
      if (e.target === sheet && e.propertyName === 'transform') finish();
    };
    sheet.addEventListener('transitionend', onEnd);
    setTimeout(finish, 400);
  }, [hidden]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [dismiss]);

  useEffect(() => {
    const sheet = sheetRef.current;
    const back = backRef.current;
    const dim = dimRef.current;
    const body = bodyRef.current;
    if (!sheet || !back || !dim || !body) return;

    // "Closing distance" along the dismiss direction: down for bottom, left for left.
    const along = (t: Touch) => (left ? -t.clientX : t.clientY);
    let startX = 0;
    let startY = 0;
    let start = 0;
    let last = 0;
    let lastT = 0;
    let speed = 0;
    let mode: 'idle' | 'maybe' | 'drag' | 'scroll' = 'idle';
    let inBody = false;

    const setOffset = (d: number) => {
      sheet.style.transform = d ? (left ? `translateX(${-d}px)` : `translateY(${d}px)`) : '';
      const size = (left ? sheet.offsetWidth : sheet.offsetHeight) || 1;
      dim.style.opacity = String(Math.max(0, 1 - d / size)); // follows the finger
    };

    const onStart = (e: TouchEvent) => {
      if (closing.current || e.touches.length > 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      start = last = along(t);
      lastT = e.timeStamp;
      speed = 0;
      inBody = body.contains(e.target as Node);
      mode = 'maybe';
    };

    const onMove = (e: TouchEvent) => {
      if (mode === 'idle' || closing.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (mode === 'maybe') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        const go = left
          ? dx < 0 && Math.abs(dx) > Math.abs(dy) // leftward swipe anywhere
          : dy > 0 && Math.abs(dy) > Math.abs(dx) && (!inBody || body.scrollTop <= 0); // pull down at the top
        if (go) {
          mode = 'drag';
          start = last = along(t); // follow from here (no jump)
          lastT = e.timeStamp;
          sheet.style.transition = 'none';
          dim.style.transition = 'none';
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else {
          mode = 'scroll';
        }
      }
      if (mode === 'drag') {
        e.preventDefault();
        const a = along(t);
        const dt = e.timeStamp - lastT;
        if (dt > 0) speed = (a - last) / dt;
        last = a;
        lastT = e.timeStamp;
        setOffset(Math.max(0, a - start));
      } else if (!inBody || body.scrollHeight <= body.clientHeight) {
        // Nothing scrollable under the finger: keep the page behind from moving.
        e.preventDefault();
      }
    };

    const onEnd = () => {
      if (mode !== 'drag') {
        mode = 'idle';
        return;
      }
      mode = 'idle';
      const off = last - start;
      if (off > CLOSE_DIST || (speed > CLOSE_SPEED && off > 20)) {
        dismiss();
      } else {
        sheet.style.transition = `transform .3s ${EASE}`;
        dim.style.transition = 'opacity .3s';
        setOffset(0);
      }
    };

    // Backdrop touches must never scroll/bounce the page behind it.
    const block = (e: TouchEvent) => {
      if (!sheet.contains(e.target as Node)) e.preventDefault();
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    back.addEventListener('touchmove', block, { passive: false });
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
      back.removeEventListener('touchmove', block);
    };
  }, [dismiss, left]);

  return (
    <div className={`sheet-backdrop ${side}`} ref={backRef} onClick={dismiss}>
      {/* Dim drawn as a gradient layer, not a background-color: iOS tints the status bar from
          the background-color of fixed elements at the top and lags restoring it (black flash). */}
      <div className="sheet-dim" ref={dimRef} />
      <div className={`sheet ${side}`} ref={sheetRef} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {!left && <div className="sheet-grip" aria-hidden="true" />}
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={dismiss} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="sheet-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
