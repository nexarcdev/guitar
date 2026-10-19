import type { CSSProperties } from 'react';
import { cx } from './tone';
import s from './Fretboard.module.css';

export type MarkTone = 'root' | 'chord' | 'scale' | 'target' | 'heard' | 'dim';

export interface FretMark {
  /** String, 0 = low E. */
  s: number;
  /** Fret, 0 = open (drawn at the nut). */
  f: number;
  tone: MarkTone;
  note?: string;
  /** Interval name for the intervals view ("1", "♭3"). */
  iv?: string;
}

export interface FretboardProps {
  /** How many frets to draw after the nut column. */
  frets?: number;
  /** First fret drawn. */
  from?: number;
  marks?: readonly FretMark[];
  /** What a mark shows. */
  mode?: 'notes' | 'intervals' | 'dots';
  /** Glass and well for dark faces, paper for lessons. */
  surface?: 'glass' | 'well' | 'paper';
  rowH?: number;
  /** Open-string names, low E first. */
  tuning?: readonly string[];
  /** Strings drawn muted (× at the nut). */
  muted?: readonly number[];
  onTap?: (string: number, fret: number) => void;
  /** Fret numbers under the board. */
  numbers?: boolean;
  className?: string;
}

const THICK = [3, 2.6, 2.2, 1.8, 1.4, 1.1];
const INLAY = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

/** The one fretboard: high e on top, tappable cells, marks by tone. */
export function Fretboard({ frets = 12, from = 1, marks = [], mode = 'notes', surface = 'glass', rowH = 32, tuning = ['E', 'A', 'D', 'G', 'B', 'e'], muted = [], onTap, numbers = true, className }: FretboardProps) {
  const dot = Math.round(rowH * 0.72);
  const fs = Math.round(dot * 0.5);
  const cols = `44px repeat(${frets}, minmax(0,1fr))`;
  const style = { '--dot': `${dot}px`, '--fs': `${fs}px`, '--dot-sm': `${Math.round(dot * 0.8)}px`, '--fs-sm': `${Math.round(fs * 0.85)}px` } as CSSProperties;

  const cell = (str: number, f: number, nut: boolean) => {
    const m = marks.find((x) => x.s === str && x.f === f);
    const isMuted = nut && muted.includes(str);
    const text = isMuted ? '×' : !m || mode === 'dots' ? '' : mode === 'intervals' ? (m.iv ?? '') : (m.note ?? '');
    const aria = `${tuning[str]} string, ${f === 0 ? 'open' : 'fret ' + f}${isMuted ? ', muted' : m ? ', marked' : ''}`;
    const inner = <span className={cx(nut ? s.nutDot : s.dot, m && s[m.tone], m && s.on, isMuted && s.muted)}>{text}</span>;
    return onTap ? (
      <button key={f} type="button" className={nut ? s.nut : s.cell} aria-label={aria} aria-pressed={!!m} onClick={() => onTap(str, f)}>
        {nut && <span className={s.name}>{tuning[str]}</span>}
        {inner}
      </button>
    ) : (
      <div key={f} className={nut ? s.nut : s.cell} aria-label={aria} role="gridcell">
        {nut && <span className={s.name}>{tuning[str]}</span>}
        {inner}
      </div>
    );
  };

  return (
    <div className={cx(s.wrap, s[surface], onTap && s.tappable, className)} style={style}>
      <div className={s.board} role={onTap ? undefined : 'grid'} aria-label="Fretboard">
        {[5, 4, 3, 2, 1, 0].map((str) => (
          <div key={str} className={s.row} role={onTap ? undefined : 'row'} style={{ gridTemplateColumns: cols, height: rowH, '--t': `${THICK[str]}px` } as CSSProperties}>
            {cell(str, 0, true)}
            {Array.from({ length: frets }, (_, k) => cell(str, from + k, false))}
          </div>
        ))}
      </div>
      {numbers && (
        <div className={s.nums} style={{ gridTemplateColumns: cols }} aria-hidden>
          <span />
          {Array.from({ length: frets }, (_, k) => {
            const f = from + k;
            return (
              <span key={f} className={INLAY.includes(f) ? s.inlay : undefined}>
                {f}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
