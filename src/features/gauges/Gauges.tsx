// Live level meters for the guitar input and the speaker output. They redraw every animation
// frame straight from engine.levels (no React state per frame) into the one Meter base, with
// meter ballistics: instant attack, smooth release and a peak hold. The input meter marks the
// threshold above which sound counts as playing; on an editable meter that threshold drags.

import { useEffect, useRef, useState } from 'react';
import { engine, type LiveLevels } from '../../audio/engine';
import { actions } from '../../state/store';
import { Meter, METER_MIN_DB, type MeterHandle } from '../../ui';
import s from './Gauges.module.css';

export const MIN_DB = METER_MIN_DB;
const dbAt = (p: number) => MIN_DB + p * -MIN_DB;
const STALE_MS = 500;

/** Calls `draw` every animation frame with the latest levels and the frame time. */
function useLevelLoop(draw: (L: LiveLevels, now: number, dt: number) => void) {
  const ref = useRef(draw);
  ref.current = draw;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      ref.current(engine.levels, now, Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Meter ballistics: instant attack, 24 dB/s release, peak held 1.2 s then falling 20 dB/s. */
class Ballistics {
  shown = -120;
  peak = -120;
  peakAt = 0;
  step(level: number, peak: number, now: number, dt: number) {
    this.shown = Math.max(level, this.shown - 24 * dt);
    if (peak >= this.peak) {
      this.peak = peak;
      this.peakAt = now;
    } else if (now - this.peakAt > 1200) this.peak -= 20 * dt;
  }
}

const threshold = (L: LiveLevels) => L.floorDb + L.openDb;

interface LevelMeterProps {
  kind: 'in' | 'out';
  label?: string;
  height?: number;
  /** Input only: drag (or arrow keys) to move the threshold. */
  editable?: boolean;
  /** Input only: mark the measured noise floor. */
  showFloor?: boolean;
  /** A dB scale under the bar. */
  scale?: number[];
}

export function LevelMeter({ kind, label, height = 18, editable, showFloor, scale }: LevelMeterProps) {
  const meter = useRef<MeterHandle>(null);
  const b = useRef(new Ballistics());
  const handle = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ db: number; until: number } | null>(null);
  const [thView, setThView] = useState(-60);
  const lastTh = useRef(-1e9);
  /** The threshold as last drawn (keyboard steps start here, not from a stale render). */
  const thNow = useRef(-60);
  const isIn = kind === 'in';

  useLevelLoop((L, now, dt) => {
    const live = now - (isIn ? L.inAt : L.outAt) < STALE_MS;
    const level = live ? (isIn ? L.inDb : L.outDb) : -120;
    const pk = live ? (isIn ? L.inPeakDb : L.outDb) : -120;
    b.current.step(level, pk, now, dt);
    const d = drag.current && now < drag.current.until ? drag.current : null;
    const th = isIn ? (d ? d.db : threshold(L)) : null;
    meter.current?.draw({ value: b.current.shown, peak: b.current.peak, threshold: th, floor: isIn ? L.floorDb : null, live, open: isIn ? live && L.gate : live && b.current.shown > -60 });
    if (isIn && th != null) {
      thNow.current = th;
      if (handle.current) handle.current.style.left = ((th - MIN_DB) / -MIN_DB) * 100 + '%';
      if (editable && Math.abs(th - lastTh.current) >= 0.5) {
        lastTh.current = th;
        setThView(Math.round(th));
      }
    }
  });

  // Dragging the threshold: the meter shows the dragged value at once and for a moment after,
  // until the channel's own state has caught up.
  const sent = useRef(0);
  const move = (db: number) => {
    db = Math.max(MIN_DB + 6, Math.min(-6, db));
    drag.current = { db, until: performance.now() + 800 };
    const now = performance.now();
    if (now - sent.current > 30) {
      sent.current = now;
      actions.setThreshold(db);
    }
  };
  const end = () => {
    if (drag.current) {
      actions.setThreshold(drag.current.db);
      drag.current.until = performance.now() + 800;
    }
  };
  const setFrom = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    move(Math.round(dbAt((clientX - r.left) / r.width)));
  };

  const name = label ?? (isIn ? 'Guitar in' : 'Speakers out');
  return (
    <Meter
      label={name}
      height={height}
      handle={meter}
      showFloor={showFloor}
      scale={scale}
      trackProps={
        editable && isIn
          ? {
              className: s.editable,
              ref: (el: HTMLDivElement | null) => {
                track.current = el;
              },
              onPointerDown: (e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFrom(e.currentTarget, e.clientX);
              },
              onPointerMove: (e) => {
                if (e.buttons) setFrom(e.currentTarget, e.clientX);
              },
              onPointerUp: end,
            } as React.HTMLAttributes<HTMLDivElement>
          : undefined
      }
    >
      {editable && isIn && (
        <div
          ref={handle}
          className={s.handle}
          role="slider"
          tabIndex={0}
          aria-label="Playing threshold"
          aria-valuemin={MIN_DB + 6}
          aria-valuemax={-6}
          aria-valuenow={thView}
          aria-valuetext={thView + ' dB'}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'PageUp' ? 6 : e.key === 'PageDown' ? -6 : 0;
            if (!step) return;
            e.preventDefault();
            const d = drag.current && performance.now() < drag.current.until ? drag.current.db : thNow.current;
            sent.current = 0;
            move(Math.round(d) + step);
            end();
          }}
        />
      )}
    </Meter>
  );
}
