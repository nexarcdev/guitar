import { cx } from './tone';
import s from './BeatStrip.module.css';

export interface BeatStep {
  /** Down, up, rest, or a muted chuck. */
  stroke: 'D' | 'U' | '-' | 'x';
  /** How far off the beat the hit landed, ms (negative is early). Null: not played yet. */
  hit?: number | null;
}

export interface BeatStripProps {
  steps: readonly BeatStep[];
  /** Steps per beat. */
  sub?: 1 | 2 | 3 | 4;
  /** The step under the playhead (-1 for none). */
  current?: number;
  legend?: string;
  arrowSize?: number;
}

const COUNT: Record<number, string[]> = { 1: [''], 2: ['', '&'], 3: ['', '&', 'a'], 4: ['', 'e', '&', 'a'] };
const ARROW = { D: '↓', U: '↑', x: '×', '-': '·' } as const;

/** Strum pattern with where each hit landed: teal within 20 ms, amber within 50, cherry beyond. */
export function BeatStrip({ steps, sub = 4, current = -1, legend = 'teal ±20 ms · amber ±50 · cherry beyond', arrowSize = 22 }: BeatStripProps) {
  const n = Math.max(1, steps.length);
  return (
    <div className={s.wrap}>
      <div className={s.strip} style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
        {steps.map((st, i) => {
          const beat = i % sub === 0;
          const rest = st.stroke === '-' || st.stroke === 'x';
          const hit = st.hit ?? null;
          const abs = Math.abs(hit ?? 0);
          const zone = hit == null ? null : abs <= 20 ? 'ok' : abs <= 50 ? 'on' : 'live';
          const missed = !rest && hit == null && i < current;
          return (
            <div key={i} className={cx(s.step, beat && s.beat, i === current && s.now, i > 0 && (beat ? s.barLine : s.subLine))}>
              <span className={cx(s.num, beat && s.numBeat)}>{beat ? String(i / sub + 1) : COUNT[sub][i % sub]}</span>
              <span className={cx(s.arrow, rest && s.rest, missed && s.missed, i < current && !rest && !missed && s.played)} style={{ fontSize: arrowSize }}>
                {ARROW[st.stroke]}
              </span>
              <span className={s.timing}>
                <span className={s.center} />
                {zone && <span className={cx(s.hit, s[zone])} style={{ left: `${50 + Math.max(-80, Math.min(80, hit!)) * 0.5}%` }} />}
              </span>
            </div>
          );
        })}
        {current >= 0 && current < n && <div className={s.playhead} style={{ left: `${((current + 0.5) / n) * 100}%` }} />}
      </div>
      <div className={s.legend}>
        <span>← early</span>
        <span>{legend}</span>
        <span>late →</span>
      </div>
    </div>
  );
}
