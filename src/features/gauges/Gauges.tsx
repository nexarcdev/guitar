// Live amp-style gauges for the guitar input and the speaker output. They redraw every animation
// frame straight from engine.levels (no React state per frame), with meter ballistics: instant
// attack, smooth release and a peak hold. The input gauge marks the measured noise floor and the
// threshold above which sound counts as playing; on the large gauge that threshold is draggable.

import { useEffect, useRef, useState } from 'react';
import { engine, type LiveLevels } from '../../audio/engine';
import { actions } from '../../state/store';
import s from './Gauges.module.css';

export const MIN_DB = -96;
const pos = (db: number) => Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB));
const dbAt = (p: number) => MIN_DB + p * -MIN_DB;
/** Hot zone: the top 6 dB. */
const HOT_DB = -6;
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

/** The colour bands depend on the threshold: quiet below it, gold above, red at the top. */
function bands(th: number | null) {
  const t = th == null ? 0 : pos(th) * 100;
  const h = pos(HOT_DB) * 100;
  return `linear-gradient(to right, rgba(247,239,232,0.22) 0%, rgba(247,239,232,0.22) ${t}%, var(--gold-lo) ${t}%, var(--gold-hi) ${h}%, var(--red) ${h}%, var(--red) 100%)`;
}

interface BarProps {
  kind: 'in' | 'out';
  size: 'mini' | 'large';
  /** Large input gauge: drag (or arrow keys) to move the threshold. */
  editable?: boolean;
}

export function LevelBar({ kind, size, editable }: BarProps) {
  const fill = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const floor = useRef<HTMLDivElement>(null);
  const thr = useRef<HTMLDivElement>(null);
  const led = useRef<HTMLSpanElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const b = useRef(new Ballistics());
  const drag = useRef<{ db: number; until: number } | null>(null);
  const lastBands = useRef('');
  const [thView, setThView] = useState(-60);
  const lastTh = useRef(-1e9);
  /** The threshold as last drawn (keyboard steps start here, not from a stale render). */
  const thNow = useRef(-60);
  const isIn = kind === 'in';

  useLevelLoop((L, now, dt) => {
    const at = isIn ? L.inAt : L.outAt;
    const live = now - at < STALE_MS;
    const level = live ? (isIn ? L.inDb : L.outDb) : -120;
    const pk = live ? (isIn ? L.inPeakDb : L.outDb) : -120;
    b.current.step(level, pk, now, dt);
    const d = drag.current && now < drag.current.until ? drag.current : null;
    const th = isIn ? (d ? d.db : threshold(L)) : null;
    if (fill.current) fill.current.style.clipPath = `inset(0 ${(1 - pos(b.current.shown)) * 100}% 0 0)`;
    if (peak.current) {
      peak.current.style.left = pos(b.current.peak) * 100 + '%';
      peak.current.style.opacity = b.current.peak > MIN_DB ? '1' : '0';
    }
    const bg = bands(th);
    if (bg !== lastBands.current && fill.current) {
      lastBands.current = bg;
      fill.current.style.background = bg;
    }
    if (isIn) {
      if (floor.current) floor.current.style.left = pos(L.floorDb) * 100 + '%';
      if (thr.current) thr.current.style.left = pos(th!) * 100 + '%';
      thNow.current = th!;
      if (led.current) led.current.dataset.on = String(live && L.gate);
      if (editable && Math.abs(th! - lastTh.current) >= 0.5) {
        lastTh.current = th!;
        setThView(Math.round(th!));
      }
    }
    if (readout.current) readout.current.textContent = live ? (b.current.shown < -90 ? '−∞' : Math.round(b.current.shown) + ' dB') : 'off';
  });

  // Dragging the threshold: the gauge shows the dragged value at once and for a moment after,
  // until the channel's own state has caught up.
  const setFrom = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const db = Math.round(dbAt((clientX - r.left) / r.width));
    move(db);
  };
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

  return (
    <div className={`${s.bar} ${size === 'large' ? s.large : s.mini}`}>
      {size === 'large' && (
        <div className={s.barHead}>
          {isIn && <span ref={led} className={s.led} data-on="false" title="Playing (gate open)" />}
          <span className={s.barLabel}>{isIn ? 'Guitar in' : 'Speakers out'}</span>
          <span ref={readout} className={s.readout}>off</span>
        </div>
      )}
      <div
        ref={track}
        className={s.track}
        onPointerDown={
          editable
            ? (e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                setFrom(e.clientX);
              }
            : undefined
        }
        onPointerMove={editable ? (e) => e.buttons && setFrom(e.clientX) : undefined}
        onPointerUp={editable ? end : undefined}
        style={editable ? { cursor: 'ew-resize', touchAction: 'none' } : undefined}
      >
        <div ref={fill} className={s.fill} />
        <div ref={peak} className={s.peak} />
        {isIn && <div ref={floor} className={s.floor} title="Noise floor" />}
        {isIn && (
          <div
            ref={thr}
            className={editable ? s.handle : s.thr}
            {...(editable
              ? {
                  role: 'slider',
                  tabIndex: 0,
                  'aria-label': 'Playing threshold',
                  'aria-valuemin': MIN_DB + 6,
                  'aria-valuemax': -6,
                  'aria-valuenow': thView,
                  'aria-valuetext': thView + ' dB',
                  onKeyDown: (e: React.KeyboardEvent) => {
                    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'PageUp' ? 6 : e.key === 'PageDown' ? -6 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const d = drag.current && performance.now() < drag.current.until ? drag.current.db : thNow.current;
                    sent.current = 0;
                    move(Math.round(d) + step);
                    end();
                  },
                }
              : {})}
          />
        )}
      </div>
      {size === 'large' && (
        <div className={s.scale} aria-hidden>
          {[-96, -72, -48, -24, -12, 0].map((d) => (
            <span key={d} style={{ left: pos(d) * 100 + '%' }}>
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact IN/OUT pair for the header; opens the Studio's Input tab. */
export function MiniGauges() {
  return (
    <button className={s.minis} aria-label="Levels: open Studio input" title="Guitar in and speakers out" onClick={() => actions.openStudio('input')}>
      <span className={s.miniRow}>
        <span className={s.miniLabel}>IN</span>
        <LevelBar kind="in" size="mini" />
      </span>
      <span className={s.miniRow}>
        <span className={s.miniLabel}>OUT</span>
        <LevelBar kind="out" size="mini" />
      </span>
    </button>
  );
}

// ---- VU gauge (Pedals page)

const VU_MIN = -60;
const SWEEP = 50; // degrees either side of centre
const ang = (db: number) => (Math.max(0, Math.min(1, (db - VU_MIN) / -VU_MIN)) * 2 - 1) * SWEEP;
const CX = 100;
const CY = 108;
const R = 82;
function arc(a0: number, a1: number, r = R) {
  const p = (a: number) => [CX + r * Math.sin((a * Math.PI) / 180), CY - r * Math.cos((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}
function tick(db: number, r0: number, r1: number) {
  const a = (ang(db) * Math.PI) / 180;
  return { x1: CX + r0 * Math.sin(a), y1: CY - r0 * Math.cos(a), x2: CX + r1 * Math.sin(a), y2: CY - r1 * Math.cos(a) };
}

/** An amp-style needle gauge: dim below the threshold, gold above, red at the top. */
export function VuGauge({ kind }: { kind: 'in' | 'out' }) {
  const needle = useRef<SVGGElement>(null);
  const readout = useRef<SVGTextElement>(null);
  const [th, setTh] = useState<number | null>(kind === 'in' ? -60 : null);
  const [fl, setFl] = useState(-80);
  const shown = useRef(-120);
  const isIn = kind === 'in';

  useLevelLoop((L, now, dt) => {
    const live = now - (isIn ? L.inAt : L.outAt) < STALE_MS;
    const target = live ? (isIn ? L.inDb : L.outDb) : -120;
    // Needle with a little mass: about 60 ms to settle.
    shown.current += (Math.max(target, VU_MIN - 4) - shown.current) * Math.min(1, dt / 0.06);
    if (needle.current) needle.current.style.transform = `rotate(${ang(shown.current)}deg)`;
    if (readout.current) readout.current.textContent = live ? (shown.current < VU_MIN ? '−∞' : Math.round(shown.current) + ' dB') : 'off';
    if (isIn) {
      const t = Math.round(threshold(L));
      if (t !== th) setTh(t);
      const f = Math.round(L.floorDb);
      if (f !== fl) setFl(f);
    }
  });

  const tq = th ?? VU_MIN;
  return (
    <figure className={s.vu} aria-label={isIn ? 'Guitar input level' : 'Speaker output level'}>
      <svg viewBox="0 0 200 124" role="img">
        <path d={arc(-SWEEP, ang(Math.max(VU_MIN, tq)))} className={s.vuDim} />
        <path d={arc(ang(Math.max(VU_MIN, tq)), ang(HOT_DB))} className={s.vuGold} />
        <path d={arc(ang(HOT_DB), SWEEP)} className={s.vuRed} />
        {[-60, -48, -36, -24, -12, -6, 0].map((d) => (
          <g key={d}>
            <line {...tick(d, R - 12, R - 4)} className={s.vuTick} />
            <text x={tick(d, R - 22, 0).x1} y={tick(d, R - 22, 0).y1 + 3} className={s.vuNum}>
              {d}
            </text>
          </g>
        ))}
        {isIn && fl > VU_MIN && <line {...tick(fl, R - 4, R + 8)} className={s.vuFloor} />}
        {isIn && th != null && th > VU_MIN && <line {...tick(th, R - 6, R + 10)} className={s.vuThr} />}
        <g ref={needle} style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${-SWEEP}deg)` }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R - 4} className={s.vuNeedle} />
        </g>
        <circle cx={CX} cy={CY} r={5} className={s.vuPivot} />
        <text x={14} y={120} className={s.vuName}>{isIn ? 'IN' : 'OUT'}</text>
        <text ref={readout} x={186} y={120} className={s.vuRead}>off</text>
      </svg>
    </figure>
  );
}
