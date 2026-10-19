import type { CSSProperties } from 'react';
import { cx } from './tone';
import s from './ChordChart.module.css';

export interface ChordChartProps {
  /** Chord name printed at the top. */
  chord: string;
  /** Quality or a short note ("major", "barre 3"). */
  sub?: string;
  /** Six frets, low E first: -1 muted, 0 open, otherwise the absolute fret. */
  frets: readonly number[];
  /** Finger numbers per string (0 or '' for none). */
  fingers?: ReadonlyArray<number | string>;
  /** First fret shown (1 draws the nut). */
  baseFret?: number;
  /** Draw a barre across the lowest fret when three or more strings share it. */
  barre?: boolean;
  width?: number;
  /** Lying on paper: a hairline edge and soft lift, no dark halo. */
  flat?: boolean;
  /** Muted-string marks. */
  accent?: string;
  className?: string;
}

const ROWS = 5;
const PAD = 10;

/** A chord box printed on manila card. */
export function ChordChart({ chord, sub, frets, fingers = [], baseFret = 1, barre, width = 150, flat, accent = '#c8431f', className }: ChordChartProps) {
  const gridH = Math.round((width - 28 - PAD * 2) * 1.15);
  const dot = Math.round(width / 8);
  const rel = (f: number) => f - baseFret + 1;
  // Fret numbers beside the grid need room on the left.
  const padL = baseFret > 1 ? PAD + 8 : PAD;
  const pressed = frets.map((f, i) => ({ f, i })).filter((x) => x.f > 0 && rel(x.f) >= 1 && rel(x.f) <= ROWS);
  let bar: { l: number; r: number; top: number; fret: number; last: number } | null = null;
  if (barre && pressed.length) {
    const low = Math.min(...pressed.map((x) => x.f));
    const on = pressed.filter((x) => x.f === low).map((x) => x.i);
    if (on.length >= 3) bar = { l: (on[0] / 5) * 100, r: 100 - (on[on.length - 1] / 5) * 100, top: ((rel(low) - 0.5) / ROWS) * 100, fret: low, last: on[on.length - 1] };
  }
  const label = `${chord}${sub ? ' ' + sub : ''}: ${frets.map((f) => (f < 0 ? 'x' : f)).join(' ')}`;
  return (
    <div className={cx(s.card, flat && s.flat, className)} style={{ width, '--dot': `${dot}px` } as CSSProperties} role="img" aria-label={label}>
      <div className={s.grain} aria-hidden />
      <div className={s.head}>
        <div className={s.name} style={{ fontSize: Math.round(width / 4.6) }}>
          {chord}
        </div>
        {sub && <div className={s.sub}>{sub}</div>}
      </div>
      <div className={s.marks} style={{ margin: `0 ${PAD}px 2px ${padL}px` }}>
        {frets.map((f, i) => (
          <div key={i} style={{ color: f < 0 ? accent : undefined }}>
            {f < 0 ? '×' : f === 0 ? 'o' : ''}
          </div>
        ))}
      </div>
      <div className={s.grid} style={{ height: gridH, margin: `0 ${PAD}px 0 ${padL}px` }}>
        <div className={s.nut} style={{ height: baseFret === 1 ? 5 : 1.5 }} />
        <div className={s.lines} />
        {baseFret > 1 && (
          <div className={s.fretNums}>
            {Array.from({ length: ROWS }, (_, k) => (
              <span key={k}>{baseFret + k}</span>
            ))}
          </div>
        )}
        {/* The bar under the dots: the finger number on its last string stays readable. */}
        {bar && <div className={s.barre} style={{ left: `${bar.l}%`, right: `${bar.r}%`, top: `${bar.top}%` }} />}
        {pressed.filter(({ f, i }) => !bar || f !== bar.fret || i === bar.last).map(({ f, i }) => (
          <div key={i} className={s.dot} style={{ left: `${(i / 5) * 100}%`, top: `${((rel(f) - 0.5) / ROWS) * 100}%` }}>
            {fingers[i] || ''}
          </div>
        ))}
      </div>
    </div>
  );
}
